//! Adaptadores de los puertos de `tr-core`. Un módulo por motor, cada uno tras su feature.
//!
//! Los adaptadores solo leen modelos y nunca escriben a disco ni a registros.

#![forbid(unsafe_code)]

pub mod audio;
#[cfg(feature = "ocr-paddle")]
pub mod ocr;
pub mod screen;
#[cfg(feature = "stt-whisper")]
pub mod stt;
#[cfg(feature = "translate-opus")]
pub mod translate;
