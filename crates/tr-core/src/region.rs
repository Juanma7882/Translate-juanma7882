//! Pipeline de traducción de una región de pantalla.
//!
//! `capturar -> detección de cambio -> OCR -> normalizar -> estabilizar -> caché -> traducir -> evento`

use std::sync::Arc;

use crate::cache::TranslationCache;
use crate::change::{ChangeConfig, ChangeDetector};
use crate::ports::{Clock, EventSink, OcrEngine, ScreenCapture};
use crate::runner::{CaptureLoop, Command, FrameHandler, LoopTiming};
use crate::text::{Stabilizer, join_blocks};
use crate::translate::{Target, translate_all};
use crate::types::{Event, Frame, Lang, Region};

#[derive(Debug, Clone)]
pub struct RegionConfig {
    pub from: Lang,
    pub change: ChangeConfig,
    /// Frames consecutivos con el mismo texto antes de emitirlo.
    pub stable_frames: usize,
    /// Los bloques de OCR por debajo de esta confianza se descartan.
    pub min_confidence: f32,
}

impl RegionConfig {
    pub fn new(from: Lang) -> Self {
        Self {
            from,
            change: ChangeConfig::default(),
            stable_frames: 2,
            min_confidence: 0.3,
        }
    }
}

/// Núcleo síncrono del pipeline: procesa un frame por llamada. Sin hilos ni reloj propios,
/// por lo que se prueba de forma determinista.
pub struct RegionProcessor {
    config: RegionConfig,
    ocr: Box<dyn OcrEngine>,
    /// Destinos de la traducción, en el orden de las líneas; vacío = solo el texto original.
    targets: Vec<Target>,
    cache: Arc<TranslationCache>,
    sink: Arc<dyn EventSink>,
    clock: Arc<dyn Clock>,
    detector: ChangeDetector,
    stabilizer: Stabilizer,
    last_text: String,
    translating: bool,
}

impl RegionProcessor {
    pub fn new(
        config: RegionConfig,
        ocr: Box<dyn OcrEngine>,
        targets: Vec<Target>,
        cache: Arc<TranslationCache>,
        sink: Arc<dyn EventSink>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            detector: ChangeDetector::new(config.change),
            stabilizer: Stabilizer::new(config.stable_frames),
            config,
            ocr,
            targets,
            cache,
            sink,
            clock,
            last_text: String::new(),
            translating: true,
        }
    }

    /// Activa o desactiva la traducción. El OCR sigue corriendo para saber si hay texto.
    /// Al reactivarla, el texto actual vuelve a emitirse cuando se estabiliza.
    pub fn set_translating(&mut self, translating: bool) {
        if translating && !self.translating {
            self.stabilizer.reset();
        }
        self.translating = translating;
    }

    /// Procesa un frame y devuelve si hay texto en la región.
    ///
    /// Un frame equivalente al anterior no ejecuta OCR: cuenta como una observación más del
    /// último texto. Si el OCR falla se informa el error y se devuelve la última respuesta
    /// conocida; el frame se reintentará en la próxima vuelta.
    pub fn process(&mut self, frame: &Frame) -> bool {
        if self.detector.changed(frame) {
            match self.ocr.recognize(frame, &self.config.from) {
                Ok(blocks) => {
                    self.last_text = join_blocks(&blocks, self.config.min_confidence);
                }
                Err(error) => {
                    self.sink.emit(Event::from(&error));
                    self.detector.reset();
                    return !self.last_text.is_empty();
                }
            }
        }

        let has_text = !self.last_text.is_empty();
        if self.translating
            && let Some(stable) = self.stabilizer.observe(&self.last_text)
        {
            self.translate_and_emit(stable);
        }
        has_text
    }

    fn translate_and_emit(&mut self, original: String) {
        let outcome = translate_all(&self.targets, &self.config.from, &original, &self.cache);
        for error in &outcome.errors {
            self.sink.emit(Event::from(error));
        }
        // Si todos los destinos fallaron, reintentar en la próxima vuelta en vez de quedar sin
        // traducción. Si alguno tuvo éxito se muestra y el que falló no se reintenta hasta que
        // cambie el texto: así un destino roto no inunda de errores a cada frame.
        if !self.targets.is_empty() && outcome.translations.is_empty() {
            self.stabilizer.reset();
            self.detector.reset();
            return;
        }
        self.sink.emit(Event::Translation {
            original,
            translations: outcome.translations,
            timestamp: self.clock.now(),
        });
    }
}

struct RegionHandler(RegionProcessor);

impl FrameHandler for RegionHandler {
    fn handle(&mut self, frame: Frame) {
        self.0.process(&frame);
    }

    fn command(&mut self, _command: Command) {}
}

/// Pipeline completo con hilos: captura periódica y procesamiento "último gana".
pub struct RegionPipeline {
    inner: CaptureLoop,
}

impl RegionPipeline {
    pub fn start(
        region: Region,
        screen: Box<dyn ScreenCapture>,
        processor: RegionProcessor,
        sink: Arc<dyn EventSink>,
        timing: LoopTiming,
    ) -> Self {
        let handler = Box::new(RegionHandler(processor));
        Self {
            inner: CaptureLoop::start(region, screen, handler, sink, timing),
        }
    }

    pub fn pause(&self) {
        self.inner.pause();
    }

    pub fn resume(&self) {
        self.inner.resume();
    }

    /// Detiene el pipeline; al volver no se emiten más eventos. Idempotente.
    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CoreError;
    use crate::testing::{FakeClock, FakeOcr, FakeScreen, FakeTranslator, RecordingSink};
    use std::time::Duration;

    struct Rig {
        processor: RegionProcessor,
        ocr: FakeOcr,
        translator: FakeTranslator,
        sink: RecordingSink,
    }

    fn rig() -> Rig {
        let (ocr, translator, sink) = (FakeOcr::new(), FakeTranslator::new(), RecordingSink::new());
        let config = RegionConfig::new(Lang::new("en").unwrap());
        let targets = vec![Target::new(
            Lang::new("es").unwrap(),
            Arc::new(translator.clone()),
        )];
        let processor = RegionProcessor::new(
            config,
            Box::new(ocr.clone()),
            targets,
            Arc::new(TranslationCache::default()),
            Arc::new(sink.clone()),
            Arc::new(FakeClock::new()),
        );
        Rig {
            processor,
            ocr,
            translator,
            sink,
        }
    }

    /// Frames de brillo distinto: siempre cuentan como cambio.
    fn frame(value: u8) -> Frame {
        Frame::solid(16, 16, value)
    }

    fn translations(sink: &RecordingSink) -> Vec<(String, String)> {
        sink.events()
            .into_iter()
            .filter_map(|e| match e {
                Event::Translation {
                    original,
                    translations,
                    ..
                } => Some((original, translations[0].text.clone())),
                _ => None,
            })
            .collect()
    }

    /// Procesador con un traductor de demostración por cada código de destino.
    fn rig_with_targets(
        codes: &[&str],
    ) -> (RegionProcessor, FakeOcr, RecordingSink, Vec<FakeTranslator>) {
        let (ocr, sink) = (FakeOcr::new(), RecordingSink::new());
        let translators: Vec<FakeTranslator> =
            codes.iter().map(|_| FakeTranslator::new()).collect();
        let targets = codes
            .iter()
            .zip(&translators)
            .map(|(code, t)| Target::new(Lang::new(code).unwrap(), Arc::new(t.clone())))
            .collect();
        let processor = RegionProcessor::new(
            RegionConfig::new(Lang::new("en").unwrap()),
            Box::new(ocr.clone()),
            targets,
            Arc::new(TranslationCache::default()),
            Arc::new(sink.clone()),
            Arc::new(FakeClock::new()),
        );
        (processor, ocr, sink, translators)
    }

    fn emitted(sink: &RecordingSink) -> Vec<(String, Vec<(String, String)>)> {
        sink.events()
            .into_iter()
            .filter_map(|e| match e {
                Event::Translation {
                    original,
                    translations,
                    ..
                } => Some((
                    original,
                    translations
                        .into_iter()
                        .map(|t| (t.lang.to_string(), t.text))
                        .collect(),
                )),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn two_targets_emit_one_event_with_both_translations_in_order() {
        let (mut processor, ocr, sink, translators) = rig_with_targets(&["es", "fr"]);
        translators[0].add("hello", "hola");
        translators[1].add("hello", "bonjour");
        ocr.push_text("hello");
        processor.process(&frame(10));
        processor.process(&frame(10));
        assert_eq!(
            emitted(&sink),
            [(
                "hello".to_string(),
                vec![
                    ("es".into(), "hola".into()),
                    ("fr".into(), "bonjour".into())
                ]
            )]
        );
    }

    #[test]
    fn no_targets_emits_the_original_without_calling_any_translator() {
        let (mut processor, ocr, sink, translators) = rig_with_targets(&[]);
        assert!(translators.is_empty());
        ocr.push_text("hello");
        processor.process(&frame(10));
        processor.process(&frame(10));
        assert_eq!(emitted(&sink), [("hello".to_string(), vec![])]);
    }

    #[test]
    fn one_failing_target_still_emits_the_other_and_reports_the_error() {
        let (mut processor, ocr, sink, translators) = rig_with_targets(&["es", "fr"]);
        translators[1].fail_next(CoreError::Translation("offline".into()));
        ocr.push_text("hello");
        processor.process(&frame(10));
        processor.process(&frame(10));
        let events = sink.events();
        assert!(events.iter().any(|e| matches!(
            e,
            Event::Error {
                category: crate::ErrorCategory::Translation,
                ..
            }
        )));
        assert_eq!(
            emitted(&sink),
            [(
                "hello".to_string(),
                vec![("es".into(), "[es] hello".into())]
            )]
        );
    }

    #[test]
    fn all_targets_failing_retries_instead_of_emitting_an_empty_event() {
        let (mut processor, ocr, sink, translators) = rig_with_targets(&["es", "fr"]);
        for t in &translators {
            t.fail_next(CoreError::Translation("offline".into()));
        }
        ocr.push_text("hello");
        processor.process(&frame(10));
        processor.process(&frame(10));
        assert!(emitted(&sink).is_empty());
        processor.process(&frame(10));
        processor.process(&frame(10));
        assert_eq!(emitted(&sink).len(), 1, "se recupera en el reintento");
    }

    #[test]
    fn new_text_emits_a_translation_once_stable() {
        let mut rig = rig();
        rig.translator.add("hello", "hola");
        rig.ocr.push_text("hello");
        assert!(rig.processor.process(&frame(10)));
        assert!(rig.sink.is_empty(), "una sola observación no alcanza");
        assert!(rig.processor.process(&frame(10)));
        assert_eq!(translations(&rig.sink), [("hello".into(), "hola".into())]);
    }

    #[test]
    fn identical_frames_run_ocr_only_once() {
        let mut rig = rig();
        rig.ocr.push_text("hello");
        for _ in 0..5 {
            rig.processor.process(&frame(10));
        }
        assert_eq!(rig.ocr.calls(), 1);
        assert_eq!(translations(&rig.sink).len(), 1, "se emite una sola vez");
    }

    #[test]
    fn text_that_keeps_changing_is_not_emitted() {
        let mut rig = rig();
        rig.ocr
            .push_text("he")
            .push_text("hel")
            .push_text("hello")
            .push_text("hello");
        for value in [0, 50, 100] {
            rig.processor.process(&frame(value));
        }
        assert!(rig.sink.is_empty());
        rig.processor.process(&frame(150));
        assert_eq!(translations(&rig.sink).len(), 1);
        assert_eq!(translations(&rig.sink)[0].0, "hello");
    }

    #[test]
    fn repeated_text_is_served_from_cache() {
        let mut rig = rig();
        rig.ocr
            .push_text("A")
            .push_text("A")
            .push_text("B")
            .push_text("B");
        rig.ocr.push_text("A").push_text("A");
        for value in [0, 50, 100, 150, 200, 250] {
            rig.processor.process(&frame(value));
        }
        let emitted: Vec<_> = translations(&rig.sink).into_iter().map(|t| t.0).collect();
        assert_eq!(emitted, ["A", "B", "A"]);
        assert_eq!(
            rig.translator.call_count(),
            2,
            "la segunda A sale de la caché"
        );
    }

    #[test]
    fn a_black_frame_is_just_a_frame_without_text() {
        // Contenido protegido (DRM) o pantalla apagada: el sistema entrega negro, no un error.
        let mut rig = rig();
        for _ in 0..3 {
            assert!(!rig.processor.process(&Frame::solid(16, 16, 0)));
        }
        assert!(rig.sink.is_empty(), "sin eventos ni errores");
        assert_eq!(
            rig.ocr.calls(),
            1,
            "frames negros idénticos no repiten el OCR"
        );
    }

    #[test]
    fn has_text_reflects_the_ocr_result() {
        let mut rig = rig();
        rig.ocr.push_empty();
        assert!(!rig.processor.process(&frame(10)));
        rig.ocr.push_text("x");
        assert!(rig.processor.process(&frame(100)));
    }

    #[test]
    fn low_confidence_blocks_do_not_count_as_text() {
        let mut rig = rig();
        let mut block = crate::types::TextBlock::new("noise");
        block.confidence = 0.05;
        rig.ocr.push_blocks(vec![block]);
        assert!(!rig.processor.process(&frame(10)));
    }

    #[test]
    fn ocr_failure_is_reported_and_the_frame_is_retried() {
        let mut rig = rig();
        rig.ocr
            .push_error(CoreError::Ocr("engine crashed".into()))
            .push_text("hello");
        rig.processor.process(&frame(10));
        assert!(matches!(
            rig.sink.events()[..],
            [Event::Error {
                category: crate::ErrorCategory::Ocr,
                ..
            }]
        ));
        // El mismo frame (idéntico) se reintenta porque el fallo reinició el detector.
        rig.processor.process(&frame(10));
        rig.processor.process(&frame(10));
        assert_eq!(rig.ocr.calls(), 2);
        assert_eq!(translations(&rig.sink).len(), 1);
    }

    #[test]
    fn translation_failure_is_reported_and_retried() {
        let mut rig = rig();
        rig.ocr.push_text("hello");
        rig.translator
            .fail_next(CoreError::Translation("offline".into()));
        rig.processor.process(&frame(10));
        rig.processor.process(&frame(10)); // estable -> el traductor falla
        assert!(matches!(
            rig.sink.events()[..],
            [Event::Error {
                category: crate::ErrorCategory::Translation,
                ..
            }]
        ));
        assert!(translations(&rig.sink).is_empty());
        rig.processor.process(&frame(10));
        rig.processor.process(&frame(10));
        assert_eq!(
            translations(&rig.sink).len(),
            1,
            "se recupera sin intervención"
        );
    }

    #[test]
    fn disabling_translation_keeps_ocr_but_emits_nothing() {
        let mut rig = rig();
        rig.ocr.push_text("hello");
        rig.processor.set_translating(false);
        for _ in 0..3 {
            assert!(rig.processor.process(&frame(10)));
        }
        assert!(rig.sink.is_empty());
        assert_eq!(rig.translator.call_count(), 0);
        rig.processor.set_translating(true);
        rig.processor.process(&frame(10));
        rig.processor.process(&frame(10));
        assert_eq!(
            translations(&rig.sink).len(),
            1,
            "el texto visible se emite al reactivar"
        );
    }

    fn start_pipeline(
        rig: Rig,
        screen: &FakeScreen,
        interval: Duration,
    ) -> (RegionPipeline, FakeOcr, RecordingSink) {
        let (ocr, sink) = (rig.ocr.clone(), rig.sink.clone());
        let timing = LoopTiming {
            interval,
            idle_interval: interval,
        };
        let pipeline = RegionPipeline::start(
            Region::new(0, 0, 16, 16, 0).unwrap(),
            Box::new(screen.clone()),
            rig.processor,
            Arc::new(rig.sink),
            timing,
        );
        (pipeline, ocr, sink)
    }

    #[test]
    fn pipeline_translates_end_to_end_and_stops_cleanly() {
        let rig = rig();
        rig.ocr.push_text("hello");
        let screen = FakeScreen::new();
        screen.push_frame(frame(10));
        let (mut pipeline, _ocr, sink) = start_pipeline(rig, &screen, Duration::from_millis(5));
        assert!(sink.wait_until(Duration::from_secs(2), |e| !e.is_empty()));
        pipeline.stop();
        let count = sink.len();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(sink.len(), count, "sin eventos después de stop");
        pipeline.stop(); // idempotente
    }

    #[test]
    fn pipeline_reports_capture_errors_and_keeps_going() {
        let rig = rig();
        rig.ocr.push_text("hello");
        let screen = FakeScreen::new();
        screen
            .push_error(CoreError::Capture("no display".into()))
            .push_frame(frame(10));
        let (mut pipeline, _ocr, sink) = start_pipeline(rig, &screen, Duration::from_millis(5));
        assert!(sink.wait_until(Duration::from_secs(2), |events| {
            let error = events.iter().any(|e| {
                matches!(
                    e,
                    Event::Error {
                        category: crate::ErrorCategory::Capture,
                        ..
                    }
                )
            });
            let translation = events
                .iter()
                .any(|e| matches!(e, Event::Translation { .. }));
            error && translation
        }));
        pipeline.stop();
    }

    #[test]
    fn slow_ocr_only_processes_the_latest_frames() {
        let rig = rig();
        // Latencia holgada: en Windows `sleep(1 ms)` dura ~15 ms y las capturas serían pocas.
        rig.ocr.set_latency(Duration::from_millis(150));
        let screen = FakeScreen::new();
        for i in 0..2000 {
            screen.push_frame(frame(if i % 2 == 0 { 0 } else { 200 }));
        }
        let (mut pipeline, ocr, _sink) = start_pipeline(rig, &screen, Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(400));
        pipeline.stop();
        let (grabs, processed) = (screen.calls(), ocr.calls());
        assert!(processed >= 1);
        assert!(processed * 3 < grabs, "OCR {processed} vs capturas {grabs}");
    }

    #[test]
    fn pause_stops_capturing_and_resume_continues() {
        let rig = rig();
        let screen = FakeScreen::new();
        screen.push_frame(frame(10));
        let (mut pipeline, _ocr, _sink) = start_pipeline(rig, &screen, Duration::from_millis(5));
        std::thread::sleep(Duration::from_millis(60));
        pipeline.pause();
        std::thread::sleep(Duration::from_millis(60)); // deja terminar una captura en curso
        let paused_calls = screen.calls();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(screen.calls(), paused_calls, "en pausa no se captura");
        pipeline.resume();
        std::thread::sleep(Duration::from_millis(100));
        assert!(screen.calls() > paused_calls);
        pipeline.stop();
    }
}
