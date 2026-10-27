//! Captura del audio del sistema (lo que suena por los altavoces), convertido a mono f32 a 16 kHz.
//!
//! El audio solo viaja en memoria hacia el callback; nada se escribe a disco ni a registros.
//! - Linux: protocolo de PulseAudio/PipeWire (monitor del dispositivo de salida), en Rust puro.
//! - Windows: WASAPI en modo loopback del dispositivo de salida, vía `cpal`.
//! - macOS: CoreAudio vía `cpal` (captura del dispositivo de salida; ver docs/adr/0004-audio-stt.md).

mod chunker;
mod resample;

pub use chunker::{CHUNK_SAMPLES, Chunker};
pub use resample::{Resampler, to_mono};

#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
mod pulse;
#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
pub use pulse::PulseLoopback;

#[cfg(all(
    feature = "audio-loopback",
    any(target_os = "windows", target_os = "macos")
))]
mod cpal_loopback;
#[cfg(all(
    feature = "audio-loopback",
    any(target_os = "windows", target_os = "macos")
))]
pub use cpal_loopback::CpalLoopback;

/// Captura de audio del sistema de esta plataforma, si el build la incluye.
#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
pub type SystemAudio = PulseLoopback;
#[cfg(all(
    feature = "audio-loopback",
    any(target_os = "windows", target_os = "macos")
))]
pub type SystemAudio = CpalLoopback;
