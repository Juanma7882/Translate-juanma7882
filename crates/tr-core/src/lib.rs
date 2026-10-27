//! Núcleo del traductor: puertos (traits), tipos, pipelines y dobles de prueba.
//!
//! Este crate no conoce ningún motor concreto ni hace I/O.
//! Regla: nunca se escribe ni se loguea contenido (capturas, audio, texto, traducciones).

#![forbid(unsafe_code)]

pub mod audio;
pub mod cache;
pub mod change;
pub mod clock;
pub mod error;
pub mod fallback;
pub mod panic_hook;
pub mod ports;
pub mod region;
pub mod runner;
pub mod slot;
pub mod testing;
pub mod text;
pub mod types;

pub use error::{CoreError, ErrorCategory, Result};
pub use ports::{
    AudioCapture, ChunkCallback, Clock, EventSink, OcrEngine, ScreenCapture, SpeechToText,
    Translator,
};
pub use types::{
    AudioChunk, BBox, Event, Frame, Lang, Mode, Region, SAMPLE_RATE, Segment, SegmentKind,
    TextBlock,
};
