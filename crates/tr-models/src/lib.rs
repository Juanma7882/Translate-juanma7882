//! Modelos locales: manifiesto, descarga en el primer uso, verificación SHA-256 y estado.
//!
//! Este es el **único** crate autorizado a escribir a disco, y solo dentro de la carpeta de
//! modelos. Nunca se escribe contenido del usuario (capturas, audio, texto, traducciones).

// Excepción justificada a `clippy.toml` (`disallowed-methods`): descargar un modelo exige crear
// archivos. El escáner `no_content_leaks` sigue prohibiendo estas APIs en el resto del código.
#![allow(clippy::disallowed_methods)]
#![forbid(unsafe_code)]

mod download;
mod manager;
mod manifest;
pub mod testing;

pub use download::sha256_hex;
pub use manager::{ModelManager, ModelProgress, ModelState};
pub use manifest::{FileSpec, Manifest, ModelSpec};
