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
    /// Admite `Range: bytes=N-` (responde `206` con `Content-Range`). Si `cut_first_at` es
    /// `Some`, la primera petición se corta tras esa cantidad de bytes (la red se cae). Envía en
    /// trozos de `chunk` con una pausa de `delay` para poder cancelar a mitad.
    Resumable {
        body: Vec<u8>,
        chunk: usize,
        delay: Duration,
        cut_first_at: Option<usize>,
    },
    /// Responde `416` a cualquier petición con `Range` y el cuerpo completo si no la tiene.
    RejectsRange(Vec<u8>),
}

type Hits = Mutex<HashMap<String, usize>>;
type Ranges = Mutex<HashMap<String, Vec<Option<String>>>>;

pub struct TestServer {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    hits: Arc<Hits>,
    ranges: Arc<Ranges>,
    handle: Option<JoinHandle<()>>,
}

/// Inicio de un `Range: bytes=N-`; `None` si no es de ese formato.
fn range_start(range: &str) -> Option<usize> {
    range
        .strip_prefix("bytes=")?
        .strip_suffix('-')?
        .parse()
        .ok()
}

/// Escribe `pieces` en trozos con pausa entre ellos; se detiene al primer error.
fn write_paced(
    stream: &mut TcpStream,
    mut result: std::io::Result<()>,
    data: &[u8],
    chunk: usize,
    delay: Duration,
) -> std::io::Result<()> {
    for piece in data.chunks(chunk) {
        if result.is_err() {
            break;
        }
        result = stream.write_all(piece).and_then(|()| stream.flush());
        thread::sleep(delay);
    }
    result
}

fn respond(mut stream: TcpStream, routes: &HashMap<String, Route>, hits: &Hits, ranges: &Ranges) {
    let mut reader = BufReader::new(stream.try_clone().expect("clonar el socket"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // Leer las cabeceras (solo interesa `Range`).
    let mut range: Option<String> = None;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line == "\r\n" || line == "\n" => break,
            Ok(_) => {
                if let Some((name, value)) = line.split_once(':')
                    && name.eq_ignore_ascii_case("range")
                {
                    range = Some(value.trim().to_owned());
                }
            }
        }
    }
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .to_owned();
    let hit = {
        let mut hits = hits.lock().unwrap();
        let count = hits.entry(path.clone()).or_default();
        *count += 1;
        *count
    };
    ranges
        .lock()
        .unwrap()
        .entry(path.clone())
        .or_default()
        .push(range.clone());

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
            let result = stream.write_all(head("200 OK", body.len(), "").as_bytes());
            write_paced(&mut stream, result, body, *chunk, *delay)
        }
        Some(Route::Resumable {
            body,
            chunk,
            delay,
            cut_first_at,
        }) => {
            let start = range
                .as_deref()
                .and_then(range_start)
                .filter(|s| *s < body.len());
            let (status, extra, from) = match start {
                Some(s) => (
                    "206 Partial Content",
                    format!(
                        "Content-Range: bytes {s}-{}/{}\r\n",
                        body.len() - 1,
                        body.len()
                    ),
                    s,
                ),
                None => ("200 OK", String::new(), 0),
            };
            let rest = &body[from..];
            let result = stream.write_all(head(status, rest.len(), &extra).as_bytes());
            let limit = match (hit, cut_first_at) {
                (1, Some(cut)) => (*cut).min(rest.len()),
                _ => rest.len(),
            };
            write_paced(&mut stream, result, &rest[..limit], *chunk, *delay)
        }
        Some(Route::RejectsRange(body)) => {
            if range.is_some() {
                stream.write_all(head("416 Range Not Satisfiable", 0, "").as_bytes())
            } else {
                stream
                    .write_all(head("200 OK", body.len(), "").as_bytes())
                    .and_then(|()| stream.write_all(body))
            }
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
        let hits: Arc<Hits> = Arc::default();
        let ranges: Arc<Ranges> = Arc::default();
        let handle = {
            let (stop, hits, ranges) = (stop.clone(), hits.clone(), ranges.clone());
            thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::Acquire) {
                        break;
                    }
                    if let Ok(stream) = stream {
                        let (routes, hits, ranges) = (routes.clone(), hits.clone(), ranges.clone());
                        thread::spawn(move || respond(stream, &routes, &hits, &ranges));
                    }
                }
            })
        };
        Self {
            addr,
            stop,
            hits,
            ranges,
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

    /// Cabeceras `Range` recibidas en `path`, una por petición (`None` si no traía).
    pub fn ranges(&self, path: &str) -> Vec<Option<String>> {
        self.ranges
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .unwrap_or_default()
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
