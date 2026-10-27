//! Captura de pantalla.

pub mod geometry;

#[cfg(feature = "screen-xcap")]
mod xcap_screen;

#[cfg(feature = "screen-xcap")]
pub use xcap_screen::XcapScreen;
