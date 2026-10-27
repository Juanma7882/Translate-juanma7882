//! Servidor HTTP mínimo para pruebas (solo `std`): sirve respuestas programadas en `127.0.0.1`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Qué responde el servidor para una ruta.
#[derive(Clone)]
pub enum Route {
    Body(Vec<u8>),
    Status(u16),
    /// Anuncia `declared` bytes pero envía menos y cierra la conexión.
    Truncated {
        declared: usize,
        sent: Vec<u8>,
    },
    Redirect(String),
    /// Envía el cuerpo en trozos de `chunk` bytes con una pausa entre cada uno.
    Slow {
        body: Vec<u8>,
        chunk: usize,
        delay: Duration,
    },
}

pub struct TestServer {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    hits: Arc<Mutex<HashMap<String, usize>>>,
    handle: Option<JoinHandle<()>>,
}

fn respond(
    mut stream: TcpStream,
    routes: &HashMap<String, Route>,
    hits: &Mutex<HashMap<String, usize>>,
) {
    let mut reader = BufReader::new(stream.try_clone().expect("clonar el socket"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // Consumir las cabeceras.
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line == "\r\n" || line == "\n" => break,
            Ok(_) => {}
        }
    }
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .to_owned();
    *hits.lock().unwrap().entry(path.clone()).or_default() += 1;

    let head = |status: &str, length: usize, extra: &str| {
        format!("HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n{extra}\r\n")
    };
    let _ = match routes.get(&path) {
        None => stream.write_all(head("404 Not Found", 0, "").as_bytes()),
        Some(Route::Status(code)) => {
            stream.write_all(head(&format!("{code} Error"), 0, "").as_bytes())
        }
        Some(Route::Body(body)) => stream
            .write_all(head("200 OK", body.len(), "").as_bytes())
            .and_then(|()| stream.write_all(body)),
        Some(Route::Redirect(to)) => {
            stream.write_all(head("302 Found", 0, &format!("Location: {to}\r\n")).as_bytes())
        }
        Some(Route::Truncated { declared, sent }) => stream
            .write_all(head("200 OK", *declared, "").as_bytes())
            .and_then(|()| stream.write_all(sent)),
        Some(Route::Slow { body, chunk, delay }) => {
            let mut result = stream.write_all(head("200 OK", body.len(), "").as_bytes());
            for piece in body.chunks(*chunk) {
                if result.is_err() {
                    break;
                }
                result = stream.write_all(piece).and_then(|()| stream.flush());
                thread::sleep(*delay);
            }
            result
        }
    };
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

impl TestServer {
    pub fn start(routes: Vec<(&str, Route)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("abrir un puerto local");
        let addr = listener.local_addr().expect("dirección local");
        let routes: Arc<HashMap<String, Route>> = Arc::new(
            routes
                .into_iter()
                .map(|(path, route)| (path.to_owned(), route))
                .collect(),
        );
        let stop = Arc::new(AtomicBool::new(false));
        let hits = Arc::new(Mutex::new(HashMap::new()));
        let handle = {
            let (stop, hits) = (stop.clone(), hits.clone());
            thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::Acquire) {
                        break;
                    }
                    if let Ok(stream) = stream {
                        let (routes, hits) = (routes.clone(), hits.clone());
                        thread::spawn(move || respond(stream, &routes, &hits));
                    }
                }
            })
        };
        Self {
            addr,
            stop,
            hits,
            handle: Some(handle),
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    /// Veces que se pidió `path`.
    pub fn hits(&self, path: &str) -> usize {
        self.hits.lock().unwrap().get(path).copied().unwrap_or(0)
    }

    pub fn total_hits(&self) -> usize {
        self.hits.lock().unwrap().values().sum()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.addr); // despierta el `accept`
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
