//! Errores tipificados por categoría.
//!
//! Los mensajes describen el fallo del motor, nunca el contenido procesado
//! (texto, audio o traducciones).

use thiserror::Error;

use crate::types::Event;

pub type Result<T> = std::result::Result<T, CoreError>;

/// Categoría de un error, estable hacia el exterior (eventos y JS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCategory {
    InvalidArgument,
    Capture,
    Ocr,
    Stt,
    Translation,
    Model,
}

impl ErrorCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalid-argument",
            Self::Capture => "capture",
            Self::Ocr => "ocr",
            Self::Stt => "stt",
            Self::Translation => "translation",
            Self::Model => "model",
        }
    }
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("capture error: {0}")]
    Capture(String),
    #[error("ocr error: {0}")]
    Ocr(String),
    #[error("speech-to-text error: {0}")]
    Stt(String),
    #[error("translation error: {0}")]
    Translation(String),
    #[error("model error: {0}")]
    Model(String),
}

impl CoreError {
    pub fn category(&self) -> ErrorCategory {
        match self {
            Self::InvalidArgument(_) => ErrorCategory::InvalidArgument,
            Self::Capture(_) => ErrorCategory::Capture,
            Self::Ocr(_) => ErrorCategory::Ocr,
            Self::Stt(_) => ErrorCategory::Stt,
            Self::Translation(_) => ErrorCategory::Translation,
            Self::Model(_) => ErrorCategory::Model,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::InvalidArgument(m)
            | Self::Capture(m)
            | Self::Ocr(m)
            | Self::Stt(m)
            | Self::Translation(m)
            | Self::Model(m) => m,
        }
    }
}

impl From<&CoreError> for Event {
    fn from(error: &CoreError) -> Self {
        Event::Error {
            category: error.category(),
            message: error.message().to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_category_becomes_an_error_event() {
        let cases = [
            (
                CoreError::InvalidArgument("a".into()),
                ErrorCategory::InvalidArgument,
            ),
            (CoreError::Capture("b".into()), ErrorCategory::Capture),
            (CoreError::Ocr("c".into()), ErrorCategory::Ocr),
            (CoreError::Stt("d".into()), ErrorCategory::Stt),
            (
                CoreError::Translation("e".into()),
                ErrorCategory::Translation,
            ),
            (CoreError::Model("f".into()), ErrorCategory::Model),
        ];
        for (error, category) in cases {
            let event = Event::from(&error);
            assert_eq!(
                event,
                Event::Error {
                    category,
                    message: error.message().to_owned()
                }
            );
        }
    }

    #[test]
    fn display_includes_category_prefix() {
        assert_eq!(CoreError::Ocr("boom".into()).to_string(), "ocr error: boom");
    }

    #[test]
    fn category_names_are_stable() {
        assert_eq!(ErrorCategory::InvalidArgument.as_str(), "invalid-argument");
        assert_eq!(ErrorCategory::Stt.as_str(), "stt");
    }
}
