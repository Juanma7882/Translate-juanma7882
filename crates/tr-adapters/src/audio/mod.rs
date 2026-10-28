//! Captura del audio del sistema (lo que suena por los altavoces), convertido a mono f32 a 16 kHz.
//!
//! El audio solo viaja en memoria hacia el callback; nada se escribe a disco ni a registros.
//! - Linux: protocolo de PulseAudio/PipeWire (monitor del dispositivo de salida), en Rust puro.
//! - Windows: WASAPI en modo loopback del dispositivo de salida, vía `cpal`.
//! - macOS: CoreAudio vía `cpal` (captura del dispositivo de salida; ver docs/adr/0004-audio-stt.md).

mod chunker;
mod resample;
mod unsupported_lister;

pub use chunker::{CHUNK_SAMPLES, Chunker};
pub use resample::{Resampler, to_mono};
pub use unsupported_lister::UnsupportedSourceLister;

// Lógica pura de las fuentes por aplicación de Pulse (agrupación y selección); sin cfg de plataforma
// para poder probarla en cualquier sistema.
mod pulse_source;
pub use pulse_source::{SinkInputMeta, group_by_program, program_name, resolve_input};

#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
mod pulse;
#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
pub use pulse::{PulseLoopback, PulseSourceLister};

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

// Lista de aplicaciones con audio de esta plataforma. Cada plataforma sustituye esta línea por su
// implementación (`AudioSourceLister`); mientras no la tenga, declara que no está disponible.
#[cfg(all(feature = "audio-loopback", target_os = "linux"))]
pub type PlatformSourceLister = PulseSourceLister;
#[cfg(all(feature = "audio-loopback", target_os = "windows"))]
pub type PlatformSourceLister = WindowsSourceLister;
#[cfg(not(all(
    feature = "audio-loopback",
    any(target_os = "linux", target_os = "windows")
)))]
pub type PlatformSourceLister = UnsupportedSourceLister;

/// Captura de audio con soporte de fuente por aplicación en Windows: `start_source(Process)` usa
/// WASAPI process loopback y `System` delega en `CpalLoopback`. Tiene `set_on_ended`/`ended`.
#[cfg(all(feature = "audio-loopback", target_os = "windows"))]
pub type PlatformAudioCapture = WindowsAudio;
/// En Linux `PulseLoopback` ya admite una aplicación; en macOS solo el sistema entero.
#[cfg(all(
    feature = "audio-loopback",
    any(target_os = "linux", target_os = "macos")
))]
pub type PlatformAudioCapture = SystemAudio;

#[cfg(all(feature = "audio-loopback", target_os = "windows"))]
mod windows_process;
#[cfg(all(feature = "audio-loopback", target_os = "windows"))]
pub use windows_process::{EndedCallback, WindowsAudio, WindowsSourceLister};
