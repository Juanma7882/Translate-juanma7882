//! Traducción real con Opus-MT (Marian) sobre ONNX Runtime.

mod marian;
mod opus;

pub use marian::MarianTokenizer;
pub use opus::{MODEL_FILES, OpusMt};
