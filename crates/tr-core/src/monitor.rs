//! Escucha previa: abre una fuente de audio solo para medir su nivel.
//!
//! Es lo que mueve la barra de la interfaz antes de iniciar ninguna sesión. No hay detección de
//! voz, reconocimiento ni traducción (por eso no necesita modelos) y el audio se descarta en
//! cuanto se mide: lo único que sale son los dos números de [`Event::AudioLevel`].
//!
//! Igual que el [`AudioRunner`](crate::audio::AudioRunner), la captura solo entrega los trozos a una
//! cola acotada y un hilo propio los mide y emite, así el hilo de captura nunca espera al destino
//! de los eventos.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, bounded};

use crate::audio::{peak, rms};
use crate::error::Result;
use crate::ports::{AudioCapture, EventSink};
use crate::types::{AudioChunk, AudioSource, Event};

/// Trozos pendientes entre la captura y la medición. Si se llena se descartan los nuevos.
const QUEUE_CAPACITY: usize = 16;

struct Running {
    stop: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

/// Mide el nivel de una fuente de audio mientras vive. Se detiene con [`stop`](Self::stop) o al soltarlo.
pub struct LevelMonitor {
    capture: Box<dyn AudioCapture>,
    running: Option<Running>,
}

impl LevelMonitor {
    /// Abre `source` y empieza a emitir un [`Event::AudioLevel`] por cada trozo.
    ///
    /// Si la fuente no se puede abrir el error se **devuelve** y no se emite como evento: la escucha
    /// no es una sesión y un fallo suyo no debe parecer uno.
    pub fn start(
        mut capture: Box<dyn AudioCapture>,
        source: &AudioSource,
        sink: Arc<dyn EventSink>,
    ) -> Result<Self> {
        let (tx, rx) = bounded::<AudioChunk>(QUEUE_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let stop = stop.clone();
            thread::spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    match rx.recv_timeout(Duration::from_millis(20)) {
                        Ok(chunk) => sink.emit(Event::AudioLevel {
                            rms: rms(&chunk.samples),
                            peak: peak(&chunk.samples),
                        }),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
        };

        let started = capture.start_source(
            source,
            Box::new(move |chunk| {
                // Cola llena: se descarta el trozo en vez de bloquear la captura.
                let _ = tx.try_send(chunk);
            }),
        );
        match started {
            Ok(()) => Ok(Self {
                capture,
                running: Some(Running { stop, worker }),
            }),
            Err(error) => {
                stop.store(true, Ordering::Release);
                let _ = worker.join();
                Err(error)
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.is_some()
    }

    /// Cierra la captura y espera al hilo de medición; al volver no se emiten más niveles. Idempotente.
    pub fn stop(&mut self) {
        self.capture.stop();
        if let Some(Running { stop, worker }) = self.running.take() {
            stop.store(true, Ordering::Release);
            let _ = worker.join();
        }
    }
}

impl Drop for LevelMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::Instant;

    use super::*;
    use crate::error::CoreError;
    use crate::ports::ChunkCallback;
    use crate::testing::{FakeAudio, RecordingSink};
    use crate::types::SAMPLE_RATE;

    const WAIT: Duration = Duration::from_secs(2);

    /// Trozo de 100 ms con una amplitud constante.
    fn chunk(amplitude: f32) -> AudioChunk {
        AudioChunk::new(vec![amplitude; SAMPLE_RATE as usize / 10], Duration::ZERO)
    }

    fn levels(sink: &RecordingSink) -> Vec<(f32, f32)> {
        sink.events()
            .into_iter()
            .filter_map(|e| match e {
                Event::AudioLevel { rms, peak } => Some((rms, peak)),
                _ => None,
            })
            .collect()
    }

    fn start(audio: &FakeAudio, sink: &RecordingSink) -> LevelMonitor {
        LevelMonitor::start(
            Box::new(audio.clone()),
            &AudioSource::System,
            Arc::new(sink.clone()),
        )
        .unwrap()
    }

    #[test]
    fn every_chunk_reports_its_level() {
        let (audio, sink) = (FakeAudio::new(), RecordingSink::new());
        let mut monitor = start(&audio, &sink);
        assert!(monitor.is_running() && audio.is_running());

        audio.feed(chunk(0.25));
        audio.feed(chunk(0.0));
        audio.feed(chunk(0.5));
        assert!(sink.wait_until(WAIT, |e| e.len() >= 3));

        let levels = levels(&sink);
        assert_eq!(levels.len(), 3);
        assert!((levels[0].0 - 0.25).abs() < 1e-4 && (levels[0].1 - 0.25).abs() < 1e-4);
        assert_eq!(levels[1], (0.0, 0.0), "el silencio también se informa");
        assert!((levels[2].0 - 0.5).abs() < 1e-4);
        monitor.stop();
    }

    #[test]
    fn only_levels_come_out() {
        let (audio, sink) = (FakeAudio::new(), RecordingSink::new());
        let mut monitor = start(&audio, &sink);
        // Habla fuerte y sostenida: una sesión la habría enviado al STT; aquí solo se mide.
        for i in 0..30 {
            audio.feed(chunk(0.6));
            // Un trozo cada 100 ms en la realidad: aquí se espera a cada nivel para no llenar la cola.
            assert!(sink.wait_until(WAIT, |e| e.len() > i));
        }
        assert!(
            sink.events()
                .iter()
                .all(|e| matches!(e, Event::AudioLevel { .. }))
        );
        monitor.stop();
    }

    #[test]
    fn stop_releases_the_capture_and_silences_the_events() {
        let (audio, sink) = (FakeAudio::new(), RecordingSink::new());
        let mut monitor = start(&audio, &sink);
        audio.feed(chunk(0.3));
        assert!(sink.wait_until(WAIT, |e| !e.is_empty()));

        monitor.stop();
        assert!(!monitor.is_running() && !audio.is_running());
        assert_eq!(audio.stop_count(), 1);
        let count = sink.len();
        audio.feed(chunk(0.3));
        thread::sleep(Duration::from_millis(80));
        assert_eq!(sink.len(), count, "sin niveles después de stop");

        monitor.stop(); // idempotente
        assert_eq!(audio.stop_count(), 1);
    }

    #[test]
    fn dropping_the_monitor_closes_the_capture() {
        let (audio, sink) = (FakeAudio::new(), RecordingSink::new());
        let monitor = start(&audio, &sink);
        assert!(audio.is_running());
        drop(monitor);
        assert!(!audio.is_running());
    }

    #[test]
    fn a_failed_start_is_returned_and_not_reported_as_an_event() {
        let (audio, sink) = (FakeAudio::new(), RecordingSink::new());
        audio.fail_next_start(CoreError::Capture("no loopback device".into()));
        let error = LevelMonitor::start(
            Box::new(audio.clone()),
            &AudioSource::System,
            Arc::new(sink.clone()),
        )
        .err()
        .expect("la captura falla");
        assert!(matches!(error, CoreError::Capture(_)), "{error}");
        thread::sleep(Duration::from_millis(60));
        assert!(
            sink.events().is_empty(),
            "un fallo de la escucha no es un error de sesión"
        );
        assert!(!audio.is_running());
    }

    /// Captura que anota qué se le pidió abrir.
    #[derive(Clone, Default)]
    struct Recorder(Arc<Mutex<Vec<String>>>);

    impl AudioCapture for Recorder {
        fn start(&mut self, _on_chunk: ChunkCallback) -> Result<()> {
            self.0.lock().unwrap().push("system".into());
            Ok(())
        }

        fn start_source(&mut self, source: &AudioSource, _on_chunk: ChunkCallback) -> Result<()> {
            self.0.lock().unwrap().push(format!("{source:?}"));
            Ok(())
        }

        fn stop(&mut self) {}
    }

    #[test]
    fn the_requested_source_reaches_the_capture() {
        let recorder = Recorder::default();
        let source = AudioSource::Process {
            id: 7,
            name: "firefox.exe".into(),
        };
        let mut monitor = LevelMonitor::start(
            Box::new(recorder.clone()),
            &source,
            Arc::new(RecordingSink::new()),
        )
        .unwrap();
        monitor.stop();
        assert_eq!(
            *recorder.0.lock().unwrap(),
            ["Process { id: 7, name: \"firefox.exe\" }"]
        );
    }

    /// Destino lento: simula una interfaz que no consume los niveles a tiempo.
    struct SlowSink;

    impl EventSink for SlowSink {
        fn emit(&self, _event: Event) {
            thread::sleep(Duration::from_millis(30));
        }
    }

    #[test]
    fn a_slow_sink_never_blocks_the_capture_thread() {
        let audio = FakeAudio::new();
        let mut monitor = LevelMonitor::start(
            Box::new(audio.clone()),
            &AudioSource::System,
            Arc::new(SlowSink),
        )
        .unwrap();
        let started = Instant::now();
        for _ in 0..200 {
            audio.feed(chunk(0.1));
        }
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "la captura esperó al destino: {:?}",
            started.elapsed()
        );
        let stopping = Instant::now();
        monitor.stop();
        assert!(stopping.elapsed() < Duration::from_millis(500));
    }
}
