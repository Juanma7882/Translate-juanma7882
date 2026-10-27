//! Hook de pánico que nunca registra el mensaje.
//!
//! El mensaje de un pánico puede incluir datos del contenido procesado (por ejemplo un
//! `unwrap` sobre un texto capturado), así que solo se informa dónde ocurrió.

use std::io::Write;
use std::panic;
use std::sync::{Arc, Mutex};

pub type SharedWriter = Arc<Mutex<dyn Write + Send>>;

/// Reemplaza el hook global. Escribe `panic at <archivo:línea:col> in thread '<hilo>'`.
pub fn install(out: SharedWriter) {
    panic::set_hook(Box::new(move |info| {
        let location = info.location().map_or_else(
            || "unknown location".to_owned(),
            |l| format!("{}:{}:{}", l.file(), l.line(), l.column()),
        );
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        if let Ok(mut out) = out.lock() {
            let _ = writeln!(
                out,
                "panic at {location} in thread '{name}' (message withheld)"
            );
        }
    }));
}

/// Variante que escribe en la salida de error estándar.
pub fn install_stderr() {
    install(Arc::new(Mutex::new(std::io::stderr())));
}
