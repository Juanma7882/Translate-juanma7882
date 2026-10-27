//! Puertos: lo único que el núcleo conoce de los motores.
//!
//! Los datos circulan como valores en memoria, nunca como rutas de archivo.

use std::time::Duration;

use crate::error::Result;
use crate::types::{AudioChunk, Event, Frame, Lang, Region, Segment, TextBlock};

pub trait ScreenCapture: Send {
    fn grab(&mut self, region: &Region) -> Result<Frame>;
}

pub trait OcrEngine: Send {
    fn recognize(&mut self, frame: &Frame, lang: &Lang) -> Result<Vec<TextBlock>>;
}

/// Callback invocado desde el hilo de captura con cada trozo de audio.
pub type ChunkCallback = Box<dyn FnMut(AudioChunk) + Send>;

pub trait AudioCapture: Send {
    fn start(&mut self, on_chunk: ChunkCallback) -> Result<()>;
    fn stop(&mut self);
}

pub trait SpeechToText: Send {
    /// Procesa un trozo y devuelve los segmentos nuevos (parciales o finales).
    fn push(&mut self, chunk: &AudioChunk) -> Result<Vec<Segment>>;

    /// Como [`push`](Self::push), pero informa si tras la ventana hay silencio (`closes_utterance`):
    /// el motor puede usarlo para cerrar la frase con un segmento final. Por defecto se ignora.
    fn push_window(&mut self, chunk: &AudioChunk, closes_utterance: bool) -> Result<Vec<Segment>> {
        let _ = closes_utterance;
        self.push(chunk)
    }

    /// La intervención terminó sin una ventana de cierre con audio nuevo (la última ya se envió):
    /// devuelve lo que quedara pendiente como segmento final. Por defecto no hay nada pendiente.
    fn end_utterance(&mut self) -> Result<Vec<Segment>> {
        Ok(Vec::new())
    }
}

pub trait Translator: Send + Sync {
    fn translate(&self, text: &str, from: &Lang, to: &Lang) -> Result<String>;
}

/// Destino de los eventos. `emit` no debe bloquear.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: Event);
}

/// Reloj monótono inyectable. `now` es el tiempo transcurrido desde un origen arbitrario.
pub trait Clock: Send + Sync {
    fn now(&self) -> Duration;
    fn sleep(&self, duration: Duration);
}
