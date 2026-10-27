//! Dobles de prueba deterministas para cada puerto.
//!
//! Todos son `Clone` y comparten estado entre clones: el test conserva un clon para
//! programar respuestas e inspeccionar llamadas, y entrega otro al pipeline.
//! Las respuestas programadas se consumen en orden; al agotarse se repite la última
//! (salvo donde se indique lo contrario).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use crate::error::{CoreError, Result};
use crate::ports::{
    AudioCapture, ChunkCallback, Clock, EventSink, OcrEngine, ScreenCapture, SpeechToText,
    Translator,
};
use crate::types::{AudioChunk, Event, Frame, Lang, Region, Segment, TextBlock};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

// ---------------------------------------------------------------- FakeScreen

#[derive(Default)]
struct ScreenState {
    script: VecDeque<Result<Frame>>,
    last: Option<Frame>,
    calls: usize,
    latency: Duration,
}

#[derive(Clone, Default)]
pub struct FakeScreen(Arc<Mutex<ScreenState>>);

impl FakeScreen {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_frame(&self, frame: Frame) -> &Self {
        lock(&self.0).script.push_back(Ok(frame));
        self
    }

    pub fn push_error(&self, error: CoreError) -> &Self {
        lock(&self.0).script.push_back(Err(error));
        self
    }

    pub fn set_latency(&self, latency: Duration) {
        lock(&self.0).latency = latency;
    }

    pub fn calls(&self) -> usize {
        lock(&self.0).calls
    }
}

impl ScreenCapture for FakeScreen {
    fn grab(&mut self, _region: &Region) -> Result<Frame> {
        let (result, latency) = {
            let mut s = lock(&self.0);
            s.calls += 1;
            let result = match s.script.pop_front() {
                Some(Ok(frame)) => {
                    s.last = Some(frame.clone());
                    Ok(frame)
                }
                Some(Err(e)) => Err(e),
                None => s
                    .last
                    .clone()
                    .ok_or_else(|| CoreError::Capture("fake screen has no frames".into())),
            };
            (result, s.latency)
        };
        if !latency.is_zero() {
            std::thread::sleep(latency);
        }
        result
    }
}

// ------------------------------------------------------------------- FakeOcr

#[derive(Default)]
struct OcrState {
    script: VecDeque<Result<Vec<TextBlock>>>,
    last: Option<Vec<TextBlock>>,
    calls: usize,
    latency: Duration,
}

/// Sin respuestas programadas devuelve "sin texto".
#[derive(Clone, Default)]
pub struct FakeOcr(Arc<Mutex<OcrState>>);

impl FakeOcr {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_text(&self, text: &str) -> &Self {
        lock(&self.0)
            .script
            .push_back(Ok(vec![TextBlock::new(text)]));
        self
    }

    pub fn push_blocks(&self, blocks: Vec<TextBlock>) -> &Self {
        lock(&self.0).script.push_back(Ok(blocks));
        self
    }

    pub fn push_empty(&self) -> &Self {
        lock(&self.0).script.push_back(Ok(Vec::new()));
        self
    }

    pub fn push_error(&self, error: CoreError) -> &Self {
        lock(&self.0).script.push_back(Err(error));
        self
    }

    pub fn set_latency(&self, latency: Duration) {
        lock(&self.0).latency = latency;
    }

    pub fn calls(&self) -> usize {
        lock(&self.0).calls
    }
}

impl OcrEngine for FakeOcr {
    fn recognize(&mut self, _frame: &Frame, _lang: &Lang) -> Result<Vec<TextBlock>> {
        let (result, latency) = {
            let mut s = lock(&self.0);
            s.calls += 1;
            let result = match s.script.pop_front() {
                Some(Ok(blocks)) => {
                    s.last = Some(blocks.clone());
                    Ok(blocks)
                }
                Some(Err(e)) => Err(e),
                None => Ok(s.last.clone().unwrap_or_default()),
            };
            (result, s.latency)
        };
        if !latency.is_zero() {
            std::thread::sleep(latency);
        }
        result
    }
}

// ------------------------------------------------------------ FakeTranslator

#[derive(Default)]
struct TranslatorState {
    dictionary: HashMap<String, String>,
    failures: VecDeque<CoreError>,
    calls: Vec<String>,
    latency: Duration,
}

/// Sin entrada en el diccionario devuelve `"[<destino>] <texto>"`.
#[derive(Clone, Default)]
pub struct FakeTranslator(Arc<Mutex<TranslatorState>>);

impl FakeTranslator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, text: &str, translation: &str) -> &Self {
        lock(&self.0)
            .dictionary
            .insert(text.to_owned(), translation.to_owned());
        self
    }

    /// El siguiente `translate` falla con este error.
    pub fn fail_next(&self, error: CoreError) -> &Self {
        lock(&self.0).failures.push_back(error);
        self
    }

    pub fn set_latency(&self, latency: Duration) {
        lock(&self.0).latency = latency;
    }

    pub fn call_count(&self) -> usize {
        lock(&self.0).calls.len()
    }

    /// Textos recibidos, en orden.
    pub fn calls(&self) -> Vec<String> {
        lock(&self.0).calls.clone()
    }
}

impl Translator for FakeTranslator {
    fn translate(&self, text: &str, _from: &Lang, to: &Lang) -> Result<String> {
        let (result, latency) = {
            let mut s = lock(&self.0);
            s.calls.push(text.to_owned());
            let result = match s.failures.pop_front() {
                Some(e) => Err(e),
                None => Ok(s
                    .dictionary
                    .get(text)
                    .cloned()
                    .unwrap_or_else(|| format!("[{to}] {text}"))),
            };
            (result, s.latency)
        };
        if !latency.is_zero() {
            std::thread::sleep(latency);
        }
        result
    }
}

// ----------------------------------------------------------------- FakeAudio

#[derive(Default)]
struct AudioState {
    callback: Option<ChunkCallback>,
    running: bool,
    start_count: usize,
    stop_count: usize,
    fail_start: Option<CoreError>,
}

#[derive(Clone, Default)]
pub struct FakeAudio(Arc<Mutex<AudioState>>);

impl FakeAudio {
    pub fn new() -> Self {
        Self::default()
    }

    /// El próximo `start` falla con este error.
    pub fn fail_next_start(&self, error: CoreError) {
        lock(&self.0).fail_start = Some(error);
    }

    /// Entrega un trozo al callback registrado; no hace nada si la captura está detenida.
    pub fn feed(&self, chunk: AudioChunk) {
        let callback = lock(&self.0).callback.take();
        if let Some(mut callback) = callback {
            callback(chunk);
            let mut s = lock(&self.0);
            if s.running && s.callback.is_none() {
                s.callback = Some(callback);
            }
        }
    }

    pub fn is_running(&self) -> bool {
        lock(&self.0).running
    }

    pub fn start_count(&self) -> usize {
        lock(&self.0).start_count
    }

    pub fn stop_count(&self) -> usize {
        lock(&self.0).stop_count
    }
}

impl AudioCapture for FakeAudio {
    fn start(&mut self, on_chunk: ChunkCallback) -> Result<()> {
        let mut s = lock(&self.0);
        if let Some(error) = s.fail_start.take() {
            return Err(error);
        }
        s.start_count += 1;
        s.running = true;
        s.callback = Some(on_chunk);
        Ok(())
    }

    fn stop(&mut self) {
        let mut s = lock(&self.0);
        if s.running {
            s.stop_count += 1;
        }
        s.running = false;
        s.callback = None;
    }
}

// -------------------------------------------------------------------- FakeStt

#[derive(Default)]
struct SttState {
    script: VecDeque<Result<Vec<Segment>>>,
    pushes: usize,
    samples: usize,
}

/// Sin respuestas programadas devuelve "sin segmentos".
#[derive(Clone, Default)]
pub struct FakeStt(Arc<Mutex<SttState>>);

impl FakeStt {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_segments(&self, segments: Vec<Segment>) -> &Self {
        lock(&self.0).script.push_back(Ok(segments));
        self
    }

    pub fn push_error(&self, error: CoreError) -> &Self {
        lock(&self.0).script.push_back(Err(error));
        self
    }

    pub fn pushes(&self) -> usize {
        lock(&self.0).pushes
    }

    pub fn samples_received(&self) -> usize {
        lock(&self.0).samples
    }
}

impl SpeechToText for FakeStt {
    fn push(&mut self, chunk: &AudioChunk) -> Result<Vec<Segment>> {
        let mut s = lock(&self.0);
        s.pushes += 1;
        s.samples += chunk.samples.len();
        s.script.pop_front().unwrap_or_else(|| Ok(Vec::new()))
    }
}

// ------------------------------------------------------------------ FakeClock

/// Reloj manual: `sleep` avanza el tiempo sin bloquear.
#[derive(Clone, Default)]
pub struct FakeClock(Arc<Mutex<Duration>>);

impl FakeClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn advance(&self, by: Duration) {
        *lock(&self.0) += by;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Duration {
        *lock(&self.0)
    }

    fn sleep(&self, duration: Duration) {
        self.advance(duration);
    }
}

// -------------------------------------------------------------- RecordingSink

#[derive(Clone, Default)]
pub struct RecordingSink(Arc<Mutex<Vec<Event>>>);

impl RecordingSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn events(&self) -> Vec<Event> {
        lock(&self.0).clone()
    }

    /// Devuelve los eventos acumulados y vacía el registro.
    pub fn take(&self) -> Vec<Event> {
        std::mem::take(&mut *lock(&self.0))
    }

    pub fn len(&self) -> usize {
        lock(&self.0).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Espera (consultando cada pocos ms) hasta que los eventos acumulados cumplan `done`
    /// o venza `timeout`. Devuelve si se cumplió. Para tests con hilos reales.
    pub fn wait_until(&self, timeout: Duration, done: impl Fn(&[Event]) -> bool) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if done(&lock(&self.0)) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: Event) {
        lock(&self.0).push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Mode, SegmentKind};

    fn region() -> Region {
        Region::new(0, 0, 10, 10, 0).unwrap()
    }

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    #[test]
    fn screen_plays_script_then_repeats_last_frame() {
        let handle = FakeScreen::new();
        handle
            .push_frame(Frame::solid(2, 2, 1))
            .push_frame(Frame::solid(2, 2, 2));
        let mut screen = handle.clone();
        assert_eq!(screen.grab(&region()).unwrap(), Frame::solid(2, 2, 1));
        assert_eq!(screen.grab(&region()).unwrap(), Frame::solid(2, 2, 2));
        assert_eq!(screen.grab(&region()).unwrap(), Frame::solid(2, 2, 2));
        assert_eq!(handle.calls(), 3);
    }

    #[test]
    fn screen_fails_programmed_errors_and_when_empty() {
        let handle = FakeScreen::new();
        let mut screen = handle.clone();
        assert!(matches!(screen.grab(&region()), Err(CoreError::Capture(_))));
        handle.push_error(CoreError::Capture("boom".into()));
        assert_eq!(screen.grab(&region()).unwrap_err().message(), "boom");
    }

    #[test]
    fn ocr_defaults_to_no_text_and_follows_script() {
        let handle = FakeOcr::new();
        let mut ocr = handle.clone();
        let frame = Frame::solid(1, 1, 0);
        assert!(ocr.recognize(&frame, &lang("en")).unwrap().is_empty());
        handle
            .push_text("hello")
            .push_error(CoreError::Ocr("x".into()));
        assert_eq!(ocr.recognize(&frame, &lang("en")).unwrap()[0].text, "hello");
        assert!(ocr.recognize(&frame, &lang("en")).is_err());
        // Agotado el guion repite la última respuesta correcta.
        assert_eq!(ocr.recognize(&frame, &lang("en")).unwrap()[0].text, "hello");
        assert_eq!(handle.calls(), 4);
    }

    #[test]
    fn translator_uses_dictionary_default_and_failures() {
        let handle = FakeTranslator::new();
        handle.add("hello", "hola");
        let translator = handle.clone();
        assert_eq!(
            translator
                .translate("hello", &lang("en"), &lang("es"))
                .unwrap(),
            "hola"
        );
        assert_eq!(
            translator
                .translate("bye", &lang("en"), &lang("es"))
                .unwrap(),
            "[es] bye"
        );
        handle.fail_next(CoreError::Translation("down".into()));
        assert!(
            translator
                .translate("hello", &lang("en"), &lang("es"))
                .is_err()
        );
        assert_eq!(
            translator
                .translate("hello", &lang("en"), &lang("es"))
                .unwrap(),
            "hola"
        );
        assert_eq!(handle.call_count(), 4);
        assert_eq!(handle.calls()[1], "bye");
    }

    #[test]
    fn audio_delivers_chunks_only_while_running() {
        let handle = FakeAudio::new();
        let mut audio = handle.clone();
        let received = Arc::new(Mutex::new(0usize));
        let counter = Arc::clone(&received);
        handle.feed(AudioChunk::new(vec![0.0], Duration::ZERO)); // detenido: se ignora
        audio
            .start(Box::new(move |_| *lock(&counter) += 1))
            .unwrap();
        assert!(handle.is_running());
        handle.feed(AudioChunk::new(vec![0.0], Duration::ZERO));
        handle.feed(AudioChunk::new(vec![0.0], Duration::ZERO));
        audio.stop();
        handle.feed(AudioChunk::new(vec![0.0], Duration::ZERO));
        assert_eq!(*lock(&received), 2);
        assert_eq!((handle.start_count(), handle.stop_count()), (1, 1));
        assert!(!handle.is_running());
    }

    #[test]
    fn audio_start_can_fail_once() {
        let handle = FakeAudio::new();
        let mut audio = handle.clone();
        handle.fail_next_start(CoreError::Capture("no device".into()));
        assert!(audio.start(Box::new(|_| {})).is_err());
        assert!(audio.start(Box::new(|_| {})).is_ok());
    }

    #[test]
    fn stt_follows_script_and_counts_input() {
        let handle = FakeStt::new();
        let seg = Segment::new(
            "hi",
            SegmentKind::Final,
            Duration::ZERO,
            Duration::from_secs(1),
        );
        handle
            .push_segments(vec![seg.clone()])
            .push_error(CoreError::Stt("x".into()));
        let mut stt = handle.clone();
        let chunk = AudioChunk::new(vec![0.0; 160], Duration::ZERO);
        assert_eq!(stt.push(&chunk).unwrap(), vec![seg]);
        assert!(stt.push(&chunk).is_err());
        assert!(stt.push(&chunk).unwrap().is_empty());
        assert_eq!((handle.pushes(), handle.samples_received()), (3, 480));
    }

    #[test]
    fn clock_advances_manually_and_on_sleep() {
        let handle = FakeClock::new();
        let clock = handle.clone();
        assert_eq!(clock.now(), Duration::ZERO);
        handle.advance(Duration::from_secs(2));
        clock.sleep(Duration::from_millis(500));
        assert_eq!(clock.now(), Duration::from_millis(2500));
    }

    #[test]
    fn sink_records_and_takes_events() {
        let handle = RecordingSink::new();
        let sink: &dyn EventSink = &handle;
        assert!(handle.is_empty());
        sink.emit(Event::ModeChanged { mode: Mode::Audio });
        sink.emit(Event::ModeChanged { mode: Mode::Text });
        assert_eq!(handle.len(), 2);
        assert_eq!(handle.take().len(), 2);
        assert!(handle.events().is_empty());
    }
}
