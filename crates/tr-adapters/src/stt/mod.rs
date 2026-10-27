//! Reconocimiento de voz: Whisper en ONNX.

mod mel;
mod tokenizer;
mod utterance;
mod whisper;

pub use utterance::{MAX_UTTERANCE, Utterance};
pub use whisper::{MODEL_FILES, Transcript, WhisperStt};
