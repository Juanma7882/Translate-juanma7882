//! Pipeline de subtítulos desde audio.
//!
//! `chunks -> VAD por energía -> ventanas con solape -> STT -> parcial/final -> traducir finales -> evento`

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, bounded};

use crate::cache::TranslationCache;
use crate::error::{CoreError, Result};
use crate::ports::{AudioCapture, Clock, EventSink, SpeechToText, Translator};
use crate::text::normalize;
use crate::types::{AudioChunk, Event, Lang, SAMPLE_RATE, Segment, SegmentKind};

/// Trozos pendientes entre la captura y el procesamiento. Si se llena se descartan los nuevos.
const QUEUE_CAPACITY: usize = 64;
/// Palabras máximas que se comparan al quitar el solape entre ventanas.
const MAX_OVERLAP_WORDS: usize = 8;

#[derive(Debug, Clone)]
pub struct AudioConfig {
    pub from: Lang,
    pub to: Lang,
    /// Nivel RMS (0..1) a partir del cual un trozo cuenta como habla.
    pub vad_threshold: f32,
    /// Silencio continuo que cierra una intervención de habla.
    pub hangover: Duration,
    /// Habla mínima para enviar una ventana (descarta clics y ruidos).
    pub min_speech: Duration,
    /// Silencio previo que se conserva para no cortar el inicio de la primera palabra.
    pub preroll: Duration,
    pub window: Duration,
    pub overlap: Duration,
}

impl AudioConfig {
    pub fn new(from: Lang, to: Lang) -> Self {
        Self {
            from,
            to,
            vad_threshold: 0.01,
            hangover: Duration::from_millis(300),
            min_speech: Duration::from_millis(100),
            preroll: Duration::from_millis(200),
            window: Duration::from_secs(2),
            overlap: Duration::from_millis(500),
        }
    }
}

fn samples_to_duration(samples: usize) -> Duration {
    Duration::from_secs_f64(samples as f64 / f64::from(SAMPLE_RATE))
}

fn duration_to_samples(duration: Duration) -> usize {
    (duration.as_secs_f64() * f64::from(SAMPLE_RATE)) as usize
}

/// Nivel RMS de un trozo de audio.
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let energy: f32 = samples.iter().map(|s| s * s).sum();
    (energy / samples.len() as f32).sqrt()
}

fn word_key(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// Quita de `new` las palabras iniciales que repiten el final de `prev`
/// (el solape entre dos ventanas consecutivas). Ignora mayúsculas y puntuación.
pub fn dedupe_overlap(prev: &str, new: &str) -> String {
    let prev_words: Vec<String> = prev.split_whitespace().map(word_key).collect();
    let new_words: Vec<&str> = new.split_whitespace().collect();
    let max = prev_words.len().min(new_words.len()).min(MAX_OVERLAP_WORDS);
    for k in (1..=max).rev() {
        let tail = &prev_words[prev_words.len() - k..];
        if tail
            .iter()
            .zip(&new_words[..k])
            .all(|(a, b)| *a == word_key(b))
        {
            return new_words[k..].join(" ");
        }
    }
    new_words.join(" ")
}

/// Núcleo síncrono: recibe trozos de audio y emite subtítulos. Se prueba sin hilos.
pub struct AudioProcessor {
    config: AudioConfig,
    stt: Box<dyn SpeechToText>,
    translator: Arc<dyn Translator>,
    cache: Arc<TranslationCache>,
    sink: Arc<dyn EventSink>,
    clock: Arc<dyn Clock>,
    preroll: VecDeque<f32>,
    buffer: Vec<f32>,
    buffer_start: Duration,
    in_speech: bool,
    silence: Duration,
    /// Habla acumulada que todavía no se envió al STT.
    unsent_speech: usize,
    /// Se envió alguna ventana de la intervención en curso.
    had_windows: bool,
    prev_text: String,
}

impl AudioProcessor {
    pub fn new(
        config: AudioConfig,
        stt: Box<dyn SpeechToText>,
        translator: Arc<dyn Translator>,
        cache: Arc<TranslationCache>,
        sink: Arc<dyn EventSink>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            config,
            stt,
            translator,
            cache,
            sink,
            clock,
            preroll: VecDeque::new(),
            buffer: Vec::new(),
            buffer_start: Duration::ZERO,
            in_speech: false,
            silence: Duration::ZERO,
            unsent_speech: 0,
            had_windows: false,
            prev_text: String::new(),
        }
    }

    /// Muestras retenidas en memoria (pre-roll más la ventana en curso).
    pub fn buffered_samples(&self) -> usize {
        self.preroll.len() + self.buffer.len()
    }

    /// Descarta todo el audio retenido y el contexto de la intervención actual.
    pub fn reset(&mut self) {
        self.preroll = VecDeque::new();
        self.buffer = Vec::new();
        self.in_speech = false;
        self.silence = Duration::ZERO;
        self.unsent_speech = 0;
        self.had_windows = false;
        self.prev_text.clear();
    }

    pub fn push(&mut self, chunk: AudioChunk) {
        let speech = rms(&chunk.samples) >= self.config.vad_threshold;

        if !self.in_speech {
            if !speech {
                self.keep_preroll(&chunk.samples);
                return;
            }
            self.in_speech = true;
            self.silence = Duration::ZERO;
            self.unsent_speech = 0;
            self.buffer = self.preroll.drain(..).collect();
            self.buffer_start = chunk
                .start
                .saturating_sub(samples_to_duration(self.buffer.len()));
        }

        self.buffer.extend_from_slice(&chunk.samples);
        if speech {
            self.silence = Duration::ZERO;
            self.unsent_speech += chunk.samples.len();
        } else {
            self.silence += chunk.duration();
        }

        if self.silence >= self.config.hangover {
            self.flush();
        } else if self.buffer.len() >= duration_to_samples(self.config.window) {
            self.send_window(true);
        }
    }

    fn keep_preroll(&mut self, samples: &[f32]) {
        self.preroll.extend(samples.iter().copied());
        let cap = duration_to_samples(self.config.preroll);
        let excess = self.preroll.len().saturating_sub(cap);
        self.preroll.drain(..excess);
    }

    /// Cierra la intervención: envía lo que quede y olvida el contexto.
    fn flush(&mut self) {
        if self.unsent_speech >= duration_to_samples(self.config.min_speech) {
            self.send_window(false);
        } else if self.had_windows {
            // Ya se enviaron ventanas de esta intervención: avisar de que terminó.
            match self.stt.end_utterance() {
                Ok(segments) => segments.into_iter().for_each(|s| self.handle_segment(s)),
                Err(error) => self.sink.emit(Event::from(&error)),
            }
        }
        self.had_windows = false;
        self.buffer = Vec::new();
        self.in_speech = false;
        self.silence = Duration::ZERO;
        self.unsent_speech = 0;
        self.prev_text.clear();
    }

    fn send_window(&mut self, keep_overlap: bool) {
        let window = AudioChunk::new(self.buffer.clone(), self.buffer_start);
        if keep_overlap {
            let keep = duration_to_samples(self.config.overlap).min(self.buffer.len());
            let dropped = self.buffer.len() - keep;
            self.buffer.drain(..dropped);
            self.buffer_start += samples_to_duration(dropped);
        } else {
            self.buffer.clear();
        }
        self.unsent_speech = 0;
        self.had_windows = keep_overlap;

        match self.stt.push_window(&window, !keep_overlap) {
            Ok(segments) => segments.into_iter().for_each(|s| self.handle_segment(s)),
            Err(error) => self.sink.emit(Event::from(&error)),
        }
    }

    fn handle_segment(&mut self, segment: Segment) {
        let text = normalize(&segment.text);
        if text.is_empty() {
            return;
        }
        let original = dedupe_overlap(&self.prev_text, &text);
        // Solo los finales sirven de contexto: un parcial es provisional y lo reemplaza
        // el final siguiente, que no debe quedar recortado por él.
        if segment.kind == SegmentKind::Final {
            self.prev_text = text;
        }
        if original.is_empty() {
            return;
        }
        let timestamp = self.clock.now();
        match segment.kind {
            SegmentKind::Partial => self.sink.emit(Event::Subtitle {
                original,
                translated: None,
                is_final: false,
                timestamp,
            }),
            SegmentKind::Final => {
                let translated = self.translate(&original);
                self.sink.emit(Event::Subtitle {
                    original,
                    translated,
                    is_final: true,
                    timestamp,
                });
            }
        }
    }

    /// Traduce usando la caché; ante un fallo informa el error y devuelve `None`.
    fn translate(&self, text: &str) -> Option<String> {
        let (from, to) = (&self.config.from, &self.config.to);
        if let Some(hit) = self.cache.get(text, from, to) {
            return Some(hit);
        }
        match self.translator.translate(text, from, to) {
            Ok(translation) => {
                self.cache.insert(text, from, to, translation.clone());
                Some(translation)
            }
            Err(error) => {
                self.sink.emit(Event::from(&error));
                None
            }
        }
    }
}

struct Running {
    stop: Arc<AtomicBool>,
    worker: JoinHandle<AudioProcessor>,
}

/// Captura de audio + procesamiento en un hilo propio. Reiniciable: el procesador
/// vuelve al `AudioRunner` al detenerlo.
pub struct AudioRunner {
    capture: Box<dyn AudioCapture>,
    processor: Option<AudioProcessor>,
    sink: Arc<dyn EventSink>,
    running: Option<Running>,
}

impl AudioRunner {
    pub fn new(
        capture: Box<dyn AudioCapture>,
        processor: AudioProcessor,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            capture,
            processor: Some(processor),
            sink,
            running: None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.is_some()
    }

    /// Inicia la captura. Si falla, el error también se informa como evento.
    pub fn start(&mut self) -> Result<()> {
        if self.running.is_some() {
            return Ok(());
        }
        let mut processor = self
            .processor
            .take()
            .ok_or_else(|| CoreError::Stt("audio processor is no longer available".into()))?;
        processor.reset();

        let (tx, rx) = bounded::<AudioChunk>(QUEUE_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let stop = stop.clone();
            thread::spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    match rx.recv_timeout(Duration::from_millis(20)) {
                        Ok(chunk) => processor.push(chunk),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                processor.reset();
                processor
            })
        };

        let started = self.capture.start(Box::new(move |chunk| {
            // Cola llena: se descarta el trozo en vez de bloquear la captura.
            let _ = tx.try_send(chunk);
        }));
        match started {
            Ok(()) => {
                self.running = Some(Running { stop, worker });
                Ok(())
            }
            Err(error) => {
                stop.store(true, Ordering::Release);
                self.processor = worker.join().ok();
                self.sink.emit(Event::from(&error));
                Err(error)
            }
        }
    }

    /// Detiene la captura y espera al hilo; el audio retenido se descarta.
    pub fn stop(&mut self) {
        self.capture.stop();
        if let Some(Running { stop, worker }) = self.running.take() {
            stop.store(true, Ordering::Release);
            self.processor = worker.join().ok();
        }
    }
}

impl Drop for AudioRunner {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Pipeline de solo audio (`startAudioSubtitles`).
pub struct AudioPipeline {
    runner: AudioRunner,
}

impl AudioPipeline {
    pub fn start(
        capture: Box<dyn AudioCapture>,
        processor: AudioProcessor,
        sink: Arc<dyn EventSink>,
    ) -> Result<Self> {
        let mut runner = AudioRunner::new(capture, processor, sink);
        runner.start()?;
        Ok(Self { runner })
    }

    /// Detiene la captura; al volver no se emiten más eventos. Idempotente.
    pub fn stop(&mut self) {
        self.runner.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{FakeAudio, FakeClock, FakeStt, FakeTranslator, RecordingSink};

    const SPEECH: f32 = 0.5;
    const CHUNK_MS: u64 = 100;

    struct Rig {
        processor: AudioProcessor,
        stt: FakeStt,
        translator: FakeTranslator,
        sink: RecordingSink,
        position: Duration,
    }

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    /// Ventana de 1 s y solape de 250 ms para que los tests sean cortos.
    fn rig() -> Rig {
        let (stt, translator, sink) = (FakeStt::new(), FakeTranslator::new(), RecordingSink::new());
        let mut config = AudioConfig::new(lang("en"), lang("es"));
        config.window = Duration::from_secs(1);
        config.overlap = Duration::from_millis(250);
        let processor = AudioProcessor::new(
            config,
            Box::new(stt.clone()),
            Arc::new(translator.clone()),
            Arc::new(TranslationCache::default()),
            Arc::new(sink.clone()),
            Arc::new(FakeClock::new()),
        );
        Rig {
            processor,
            stt,
            translator,
            sink,
            position: Duration::ZERO,
        }
    }

    impl Rig {
        /// Entrega `count` trozos de 100 ms con la amplitud dada.
        fn feed(&mut self, amplitude: f32, count: usize) {
            for _ in 0..count {
                let samples = vec![amplitude; duration_to_samples(Duration::from_millis(CHUNK_MS))];
                self.processor.push(AudioChunk::new(samples, self.position));
                self.position += Duration::from_millis(CHUNK_MS);
            }
        }
    }

    fn final_segment(text: &str) -> Segment {
        Segment::new(
            text,
            SegmentKind::Final,
            Duration::ZERO,
            Duration::from_secs(1),
        )
    }

    fn partial_segment(text: &str) -> Segment {
        Segment::new(
            text,
            SegmentKind::Partial,
            Duration::ZERO,
            Duration::from_secs(1),
        )
    }

    fn subtitles(sink: &RecordingSink) -> Vec<(String, Option<String>, bool)> {
        sink.events()
            .into_iter()
            .filter_map(|e| match e {
                Event::Subtitle {
                    original,
                    translated,
                    is_final,
                    ..
                } => Some((original, translated, is_final)),
                _ => None,
            })
            .collect()
    }

    /// STT que anota si cada ventana llegó marcada como de cierre.
    #[derive(Clone, Default)]
    struct CloseRecorder(
        Arc<std::sync::Mutex<Vec<bool>>>,
        Arc<std::sync::Mutex<usize>>,
    );

    impl SpeechToText for CloseRecorder {
        fn push(&mut self, _chunk: &AudioChunk) -> Result<Vec<Segment>> {
            self.0.lock().unwrap().push(false);
            Ok(Vec::new())
        }

        fn push_window(&mut self, _chunk: &AudioChunk, closes: bool) -> Result<Vec<Segment>> {
            self.0.lock().unwrap().push(closes);
            Ok(Vec::new())
        }

        fn end_utterance(&mut self) -> Result<Vec<Segment>> {
            *self.1.lock().unwrap() += 1;
            Ok(Vec::new())
        }
    }

    #[test]
    fn only_the_last_window_of_an_utterance_is_marked_as_closing() {
        let recorder = CloseRecorder::default();
        let mut config = AudioConfig::new(lang("en"), lang("es"));
        config.window = Duration::from_secs(1);
        config.overlap = Duration::from_millis(250);
        let mut processor = AudioProcessor::new(
            config,
            Box::new(recorder.clone()),
            Arc::new(FakeTranslator::new()),
            Arc::new(TranslationCache::default()),
            Arc::new(RecordingSink::new()),
            Arc::new(FakeClock::new()),
        );
        let mut position = Duration::ZERO;
        for amplitude in std::iter::repeat_n(SPEECH, 25).chain(std::iter::repeat_n(0.0, 5)) {
            let samples = vec![amplitude; duration_to_samples(Duration::from_millis(CHUNK_MS))];
            processor.push(AudioChunk::new(samples, position));
            position += Duration::from_millis(CHUNK_MS);
        }
        let marks = recorder.0.lock().unwrap().clone();
        assert!(marks.len() >= 3, "{marks:?}");
        let ended = *recorder.1.lock().unwrap();
        // O la última ventana va marcada como de cierre, o se avisa con `end_utterance` (si la
        // última ventana coincidió con el final del habla y no quedó audio nuevo que enviar).
        let last_closes = marks[marks.len() - 1];
        assert!(marks[..marks.len() - 1].iter().all(|c| !c), "{marks:?}");
        assert!(
            last_closes || ended == 1,
            "{marks:?}, end_utterance: {ended}"
        );
    }

    #[test]
    fn a_stt_without_close_support_still_receives_every_window_through_push() {
        let mut rig = rig();
        rig.feed(SPEECH, 10);
        rig.feed(0.0, 4);
        assert!(rig.stt.pushes() >= 1, "FakeStt solo implementa push");
    }

    #[test]
    fn rms_measures_energy() {
        assert_eq!(rms(&[]), 0.0);
        assert_eq!(rms(&[0.0; 10]), 0.0);
        assert!((rms(&[0.5; 10]) - 0.5).abs() < 1e-6);
        assert!((rms(&[-0.5, 0.5]) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn dedupe_overlap_removes_repeated_boundary_words() {
        assert_eq!(dedupe_overlap("the quick brown", "brown fox"), "fox");
        assert_eq!(
            dedupe_overlap("the quick brown", "quick brown fox jumps"),
            "fox jumps"
        );
        assert_eq!(dedupe_overlap("Hello, world", "WORLD again"), "again");
        assert_eq!(dedupe_overlap("hello", "something else"), "something else");
        assert_eq!(dedupe_overlap("", "fresh start"), "fresh start");
        assert_eq!(dedupe_overlap("a b c", "b c"), "", "todo era solape");
    }

    #[test]
    fn silence_never_reaches_the_stt() {
        let mut rig = rig();
        rig.feed(0.0, 50);
        assert_eq!(rig.stt.pushes(), 0);
        assert!(rig.sink.is_empty());
    }

    #[test]
    fn noise_below_the_threshold_counts_as_silence() {
        let mut rig = rig();
        rig.feed(0.005, 30);
        assert_eq!(rig.stt.pushes(), 0);
    }

    #[test]
    fn speech_is_sent_in_windows_while_it_lasts() {
        let mut rig = rig();
        rig.feed(SPEECH, 10); // ventana de 1 s completa
        assert_eq!(rig.stt.pushes(), 1);
        rig.feed(SPEECH, 8); // 250 ms de solape + 800 ms nuevos = otra ventana
        assert_eq!(rig.stt.pushes(), 2);
    }

    #[test]
    fn short_clicks_are_discarded() {
        let mut rig = rig();
        let mut click = vec![0.0; 160]; // 10 ms de ruido fuerte
        click.iter_mut().for_each(|s| *s = 0.9);
        rig.processor.push(AudioChunk::new(click, Duration::ZERO));
        rig.feed(0.0, 5);
        assert_eq!(rig.stt.pushes(), 0);
    }

    #[test]
    fn end_of_speech_flushes_the_remainder() {
        let mut rig = rig();
        rig.feed(SPEECH, 5); // media ventana
        assert_eq!(rig.stt.pushes(), 0);
        rig.feed(0.0, 3); // 300 ms de silencio = hangover
        assert_eq!(rig.stt.pushes(), 1);
    }

    #[test]
    fn partial_is_emitted_untranslated_and_final_is_translated() {
        let mut rig = rig();
        rig.translator.add("hello world", "hola mundo");
        rig.stt.push_segments(vec![partial_segment("hello")]);
        rig.stt.push_segments(vec![final_segment("hello world")]);
        rig.feed(SPEECH, 15); // 1.ª ventana por tamaño
        rig.feed(0.0, 3); // 2.ª por fin de habla
        assert_eq!(
            subtitles(&rig.sink),
            [
                ("hello".into(), None, false),
                ("hello world".into(), Some("hola mundo".into()), true),
            ]
        );
        assert_eq!(
            rig.translator.call_count(),
            1,
            "los parciales no se traducen"
        );
    }

    #[test]
    fn word_on_the_window_boundary_appears_once() {
        let mut rig = rig();
        rig.stt
            .push_segments(vec![final_segment("the quick brown")]);
        rig.stt.push_segments(vec![final_segment("brown fox")]);
        rig.feed(SPEECH, 10); // ventana 1
        rig.feed(SPEECH, 8); // ventana 2 (con solape)
        let originals: Vec<_> = subtitles(&rig.sink).into_iter().map(|s| s.0).collect();
        assert_eq!(originals, ["the quick brown", "fox"]);
    }

    #[test]
    fn new_utterance_does_not_inherit_the_previous_context() {
        let mut rig = rig();
        rig.stt.push_segments(vec![final_segment("see you")]);
        rig.stt.push_segments(vec![final_segment("you again")]);
        rig.feed(SPEECH, 4);
        rig.feed(0.0, 3); // cierra la 1.ª intervención
        rig.feed(SPEECH, 4);
        rig.feed(0.0, 3); // cierra la 2.ª
        let originals: Vec<_> = subtitles(&rig.sink).into_iter().map(|s| s.0).collect();
        assert_eq!(originals, ["see you", "you again"]);
    }

    #[test]
    fn stt_failure_is_reported_and_processing_continues() {
        let mut rig = rig();
        rig.stt.push_error(CoreError::Stt("model crashed".into()));
        rig.stt.push_segments(vec![final_segment("ok")]);
        rig.feed(SPEECH, 4);
        rig.feed(0.0, 3);
        rig.feed(SPEECH, 4);
        rig.feed(0.0, 3);
        let events = rig.sink.events();
        assert!(matches!(
            events[0],
            Event::Error {
                category: crate::ErrorCategory::Stt,
                ..
            }
        ));
        assert_eq!(subtitles(&rig.sink).len(), 1);
    }

    #[test]
    fn translation_failure_still_shows_the_original() {
        let mut rig = rig();
        rig.translator
            .fail_next(CoreError::Translation("offline".into()));
        rig.stt.push_segments(vec![final_segment("hello")]);
        rig.feed(SPEECH, 4);
        rig.feed(0.0, 3);
        let events = rig.sink.events();
        assert!(matches!(
            events[0],
            Event::Error {
                category: crate::ErrorCategory::Translation,
                ..
            }
        ));
        assert_eq!(subtitles(&rig.sink), [("hello".into(), None, true)]);
    }

    #[test]
    fn final_translations_use_the_cache() {
        let mut rig = rig();
        rig.stt.push_segments(vec![final_segment("hello")]);
        rig.stt.push_segments(vec![final_segment("hello")]);
        for _ in 0..2 {
            rig.feed(SPEECH, 4);
            rig.feed(0.0, 3);
        }
        assert_eq!(subtitles(&rig.sink).len(), 2);
        assert_eq!(rig.translator.call_count(), 1);
    }

    #[test]
    fn reset_releases_all_retained_audio() {
        let mut rig = rig();
        rig.feed(0.0, 5); // pre-roll
        assert!(rig.processor.buffered_samples() > 0);
        rig.feed(SPEECH, 5); // ventana en curso
        assert!(rig.processor.buffered_samples() > 0);
        rig.processor.reset();
        assert_eq!(rig.processor.buffered_samples(), 0);
    }

    #[test]
    fn preroll_is_bounded() {
        let mut rig = rig();
        rig.feed(0.0, 100);
        let max = duration_to_samples(Duration::from_millis(200));
        assert!(rig.processor.buffered_samples() <= max);
    }

    // ------------------------------------------------------------ con hilos

    fn threaded(rig: Rig, audio: &FakeAudio) -> Result<AudioPipeline> {
        AudioPipeline::start(Box::new(audio.clone()), rig.processor, Arc::new(rig.sink))
    }

    fn chunk(amplitude: f32, ms: u64, start_ms: u64) -> AudioChunk {
        AudioChunk::new(
            vec![amplitude; duration_to_samples(Duration::from_millis(ms))],
            Duration::from_millis(start_ms),
        )
    }

    #[test]
    fn pipeline_emits_subtitles_and_stops_cleanly() {
        let rig = rig();
        rig.stt.push_segments(vec![final_segment("hello")]);
        let (sink, audio) = (rig.sink.clone(), FakeAudio::new());
        let mut pipeline = threaded(rig, &audio).unwrap();
        assert!(audio.is_running());
        for i in 0..4 {
            audio.feed(chunk(SPEECH, 100, i * 100));
        }
        for i in 4..7 {
            audio.feed(chunk(0.0, 100, i * 100));
        }
        assert!(sink.wait_until(Duration::from_secs(2), |e| !e.is_empty()));
        pipeline.stop();
        assert!(!audio.is_running());
        assert_eq!(audio.stop_count(), 1);
        let count = sink.len();
        audio.feed(chunk(SPEECH, 100, 1000));
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(sink.len(), count, "sin eventos después de stop");
        pipeline.stop(); // idempotente
    }

    #[test]
    fn pipeline_start_failure_is_returned_and_reported() {
        let rig = rig();
        let (sink, audio) = (rig.sink.clone(), FakeAudio::new());
        audio.fail_next_start(CoreError::Capture("no loopback device".into()));
        assert!(threaded(rig, &audio).is_err());
        assert!(matches!(
            sink.events()[..],
            [Event::Error {
                category: crate::ErrorCategory::Capture,
                ..
            }]
        ));
    }

    #[test]
    fn runner_can_be_restarted_and_starts_from_a_clean_state() {
        let rig = rig();
        let audio = FakeAudio::new();
        let mut runner =
            AudioRunner::new(Box::new(audio.clone()), rig.processor, Arc::new(rig.sink));
        for _ in 0..3 {
            runner.start().unwrap();
            assert!(runner.is_running());
            audio.feed(chunk(SPEECH, 100, 0));
            runner.stop();
            assert!(!runner.is_running());
        }
        assert_eq!((audio.start_count(), audio.stop_count()), (3, 3));
    }
}
