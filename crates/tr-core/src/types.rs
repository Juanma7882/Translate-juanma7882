//! Tipos de datos que cruzan los puertos. Todo vive en memoria.

use std::fmt;
use std::time::Duration;

use crate::error::{CoreError, ErrorCategory, Result};

/// Frecuencia de muestreo interna del audio.
pub const SAMPLE_RATE: u32 = 16_000;

/// Idioma como etiqueta tipo BCP 47 (`en`, `es`, `es-MX`, `zh-Hans`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Lang(String);

impl Lang {
    pub fn new(code: &str) -> Result<Self> {
        let invalid = || CoreError::InvalidArgument(format!("unknown language code `{code}`"));
        let mut parts = code.split(['-', '_']);
        let primary = parts.next().unwrap_or_default();
        if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|b| b.is_ascii_alphabetic()) {
            return Err(invalid());
        }
        let mut normalized = primary.to_ascii_lowercase();
        for sub in parts {
            if sub.is_empty() || sub.len() > 8 || !sub.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return Err(invalid());
            }
            normalized.push('-');
            normalized.push_str(sub);
        }
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Lang {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Rectángulo de pantalla en píxeles físicos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Identificador de monitor (0 = principal).
    pub monitor: u32,
}

impl Region {
    pub fn new(x: i32, y: i32, width: u32, height: u32, monitor: u32) -> Result<Self> {
        if width == 0 || height == 0 {
            return Err(CoreError::InvalidArgument(
                "region must not be empty".into(),
            ));
        }
        Ok(Self {
            x,
            y,
            width,
            height,
            monitor,
        })
    }
}

/// Imagen RGBA de 8 bits por canal.
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Frame {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self> {
        let expected = (width as usize) * (height as usize) * 4;
        if width == 0 || height == 0 || rgba.len() != expected {
            return Err(CoreError::InvalidArgument(
                "frame buffer does not match its dimensions".into(),
            ));
        }
        Ok(Self {
            width,
            height,
            rgba,
        })
    }

    /// Frame de un solo color; útil en tests.
    pub fn solid(width: u32, height: u32, value: u8) -> Self {
        Self {
            width,
            height,
            rgba: vec![value; (width as usize) * (height as usize) * 4],
        }
    }
}

// No se imprimen los píxeles: son contenido capturado.
impl fmt::Debug for Frame {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Frame({}x{})", self.width, self.height)
    }
}

/// Caja delimitadora relativa al frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextBlock {
    pub text: String,
    pub bbox: BBox,
    pub confidence: f32,
}

impl TextBlock {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bbox: BBox::default(),
            confidence: 1.0,
        }
    }
}

/// Trozo de audio mono f32 a [`SAMPLE_RATE`].
#[derive(Clone, PartialEq)]
pub struct AudioChunk {
    pub samples: Vec<f32>,
    /// Instante de inicio respecto al comienzo de la captura.
    pub start: Duration,
}

impl AudioChunk {
    pub fn new(samples: Vec<f32>, start: Duration) -> Self {
        Self { samples, start }
    }

    pub fn duration(&self) -> Duration {
        Duration::from_secs_f64(self.samples.len() as f64 / f64::from(SAMPLE_RATE))
    }
}

// No se imprimen las muestras: son contenido capturado.
impl fmt::Debug for AudioChunk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "AudioChunk({} samples @ {:?})",
            self.samples.len(),
            self.start
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    Partial,
    Final,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub text: String,
    pub kind: SegmentKind,
    pub start: Duration,
    pub end: Duration,
}

impl Segment {
    pub fn new(text: impl Into<String>, kind: SegmentKind, start: Duration, end: Duration) -> Self {
        Self {
            text: text.into(),
            kind,
            start,
            end,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Text,
    Audio,
    Paused,
}

/// De dónde se captura el audio: todo el sistema o una aplicación concreta.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AudioSource {
    #[default]
    System,
    /// Una aplicación, por identificador de proceso (válido solo durante la sesión) y nombre de programa.
    Process { id: u32, name: String },
}

/// Aplicación que está reproduciendo audio. Solo metadatos: nunca audio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppAudio {
    pub id: u32,
    /// Nombre del programa (p. ej. `firefox.exe`), estable entre sesiones.
    pub name: String,
}

/// Evento emitido hacia el exterior. `timestamp` es el tiempo del [`Clock`](crate::ports::Clock).
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Translation {
        original: String,
        translated: String,
        timestamp: Duration,
    },
    Subtitle {
        original: String,
        translated: Option<String>,
        is_final: bool,
        timestamp: Duration,
    },
    ModeChanged {
        mode: Mode,
    },
    /// Nivel del último trozo de audio (RMS y pico, de 0 a 1). Solo números.
    AudioLevel {
        rms: f32,
        peak: f32,
    },
    ModelProgress {
        model: String,
        downloaded: u64,
        total: Option<u64>,
    },
    Error {
        category: ErrorCategory,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lang_accepts_and_normalizes_codes() {
        assert_eq!(Lang::new("EN").unwrap().as_str(), "en");
        assert_eq!(Lang::new("es-MX").unwrap().as_str(), "es-MX");
        assert_eq!(Lang::new("zh_Hans").unwrap().as_str(), "zh-Hans");
        assert_eq!(Lang::new("fil").unwrap().to_string(), "fil");
    }

    #[test]
    fn lang_rejects_unknown_codes() {
        for bad in [
            "",
            "e",
            "english",
            "e1",
            "en-",
            "en--US",
            "en-toolongsubtag",
            "12",
        ] {
            assert!(
                matches!(Lang::new(bad), Err(CoreError::InvalidArgument(_))),
                "`{bad}` should be rejected"
            );
        }
    }

    #[test]
    fn region_rejects_empty_sizes() {
        assert!(Region::new(0, 0, 0, 10, 0).is_err());
        assert!(Region::new(0, 0, 10, 0, 0).is_err());
        let r = Region::new(-5, 3, 10, 20, 1).unwrap();
        assert_eq!((r.x, r.y, r.width, r.height, r.monitor), (-5, 3, 10, 20, 1));
    }

    #[test]
    fn frame_validates_buffer_length() {
        assert!(Frame::new(2, 2, vec![0; 16]).is_ok());
        assert!(Frame::new(2, 2, vec![0; 15]).is_err());
        assert!(Frame::new(0, 2, vec![]).is_err());
    }

    #[test]
    fn debug_output_never_contains_content() {
        let frame = Frame::new(1, 1, vec![11, 22, 33, 44]).unwrap();
        assert_eq!(format!("{frame:?}"), "Frame(1x1)");
        let chunk = AudioChunk::new(vec![0.123456; 4], Duration::from_secs(1));
        assert!(!format!("{chunk:?}").contains("0.123456"));
    }

    #[test]
    fn audio_chunk_duration_follows_sample_rate() {
        let chunk = AudioChunk::new(vec![0.0; SAMPLE_RATE as usize / 2], Duration::ZERO);
        assert_eq!(chunk.duration(), Duration::from_millis(500));
    }
}
