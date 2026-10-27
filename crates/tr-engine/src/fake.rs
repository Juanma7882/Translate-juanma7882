//! Motores de demostración que ciclan frases de forma determinista.
//!
//! Sirven para desarrollar y probar el flujo completo (incluido el puente a JS) sin modelos,
//! pantalla ni micrófono reales.

use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, Sender, bounded};
use tr_core::{
    AudioCapture, AudioChunk, ChunkCallback, CoreError, Frame, Lang, OcrEngine, Region, Result,
    SAMPLE_RATE, ScreenCapture, Segment, SegmentKind, SpeechToText, TextBlock,
};

const SCREEN_PHRASES: [&str; 3] = [
    "Hello, world",
    "Where is the station?",
    "Thank you very much",
];
const SPEECH_PHRASES: [&str; 3] = [
    "Good morning everyone",
    "Welcome to the demo",
    "See you tomorrow",
];

/// Cada contenido dura `FRAMES_PER_TEXT` capturas, suficiente para estabilizarse.
const FRAMES_PER_TEXT: usize = 4;
const CHUNK: Duration = Duration::from_millis(100);
/// Trozos de habla y de silencio por intervención (el silencio supera el hangover de 300 ms).
const SPEECH_CHUNKS: usize = 12;
const SILENCE_CHUNKS: usize = 4;

/// Pantalla cuyo brillo cambia cada `FRAMES_PER_TEXT` capturas.
#[derive(Default)]
pub struct DemoScreen {
    grabs: usize,
}

impl ScreenCapture for DemoScreen {
    fn grab(&mut self, region: &Region) -> Result<Frame> {
        let level = ((self.grabs / FRAMES_PER_TEXT) % 6) as u8 * 40 + 10;
        self.grabs += 1;
        Ok(Frame::solid(
            region.width.min(64),
            region.height.min(64),
            level,
        ))
    }
}

/// OCR que devuelve la siguiente frase cada vez que se invoca.
#[derive(Default)]
pub struct DemoOcr {
    calls: usize,
    latency: Duration,
}

impl DemoOcr {
    /// `latency` simula un motor lento.
    pub fn new(latency: Duration) -> Self {
        Self { calls: 0, latency }
    }
}

impl OcrEngine for DemoOcr {
    fn recognize(&mut self, _frame: &Frame, _lang: &Lang) -> Result<Vec<TextBlock>> {
        thread::sleep(self.latency);
        let text = SCREEN_PHRASES[self.calls % SCREEN_PHRASES.len()];
        self.calls += 1;
        Ok(vec![TextBlock::new(text)])
    }
}

/// STT que devuelve la siguiente frase final por cada ventana recibida.
#[derive(Default)]
pub struct DemoStt {
    calls: usize,
    latency: Duration,
}

impl DemoStt {
    /// `latency` simula un motor lento.
    pub fn new(latency: Duration) -> Self {
        Self { calls: 0, latency }
    }
}

impl SpeechToText for DemoStt {
    fn push(&mut self, chunk: &AudioChunk) -> Result<Vec<Segment>> {
        thread::sleep(self.latency);
        let text = SPEECH_PHRASES[self.calls % SPEECH_PHRASES.len()];
        self.calls += 1;
        Ok(vec![Segment::new(
            text,
            SegmentKind::Final,
            chunk.start,
            chunk.start + chunk.duration(),
        )])
    }
}

struct Worker {
    /// Soltar el emisor despierta de inmediato al hilo que espera entre trozos.
    stop: Sender<()>,
    handle: JoinHandle<()>,
}

/// Captura que genera ráfagas de "habla" seguidas de silencio, en un hilo propio.
pub struct DemoAudio {
    pace: Duration,
    worker: Option<Worker>,
}

impl DemoAudio {
    /// `pace` es la espera real entre trozos (los tiempos del audio son sintéticos).
    pub fn new(pace: Duration) -> Self {
        Self { pace, worker: None }
    }
}

impl AudioCapture for DemoAudio {
    fn start(&mut self, mut on_chunk: ChunkCallback) -> Result<()> {
        if self.worker.is_some() {
            return Err(CoreError::Capture("demo audio is already running".into()));
        }
        let (stop, stop_rx) = bounded::<()>(0);
        let pace = self.pace;
        let handle = thread::spawn(move || {
            let samples_per_chunk =
                (u64::from(SAMPLE_RATE) * CHUNK.as_millis() as u64 / 1000) as usize;
            let mut position = Duration::ZERO;
            loop {
                for i in 0..SPEECH_CHUNKS + SILENCE_CHUNKS {
                    let amplitude = if i < SPEECH_CHUNKS { 0.3 } else { 0.0 };
                    on_chunk(AudioChunk::new(
                        vec![amplitude; samples_per_chunk],
                        position,
                    ));
                    position += CHUNK;
                    if !matches!(stop_rx.recv_timeout(pace), Err(RecvTimeoutError::Timeout)) {
                        return;
                    }
                }
            }
        });
        self.worker = Some(Worker { stop, handle });
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(Worker { stop, handle }) = self.worker.take() {
            drop(stop);
            let _ = handle.join();
        }
    }
}

impl Drop for DemoAudio {
    fn drop(&mut self) {
        self.stop();
    }
}
