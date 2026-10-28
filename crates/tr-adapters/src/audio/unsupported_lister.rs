//! Lista de fuentes de las plataformas sin captura por aplicación.

use tr_core::{AppAudio, AudioSourceLister, CoreError, Result};

/// Declara que la plataforma no puede listar aplicaciones; la interfaz ofrece solo "Todo el sistema".
pub struct UnsupportedSourceLister {
    reason: &'static str,
}

impl UnsupportedSourceLister {
    pub fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl Default for UnsupportedSourceLister {
    fn default() -> Self {
        Self::new("capturing a single application is not supported on this platform")
    }
}

impl AudioSourceLister for UnsupportedSourceLister {
    fn list(&self) -> Result<Vec<AppAudio>> {
        Err(CoreError::Capture(self.reason.into()))
    }
}
