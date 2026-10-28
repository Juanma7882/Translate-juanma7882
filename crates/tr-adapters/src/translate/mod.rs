//! Traducción real con Opus-MT (Marian) sobre ONNX Runtime.

mod beam;
mod marian;
mod opus;

pub use marian::MarianTokenizer;
pub use opus::{CACHED_DECODER_FILE, MODEL_FILES, OpusMt};
