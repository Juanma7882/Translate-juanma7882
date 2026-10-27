//! Composition root: arma los pipelines a partir de la configuración.
//!
//! Es el único lugar que conoce a la vez el núcleo y los adaptadores. En este hito solo
//! existe el conjunto de motores `Fake`; los reales se suman sin tocar `tr-core`.

use std::sync::Arc;
use std::time::Duration;

use tr_core::audio::{AudioConfig, AudioPipeline, AudioProcessor, AudioRunner};
use tr_core::cache::{DEFAULT_CAPACITY, TranslationCache};
use tr_core::clock::SystemClock;
use tr_core::fallback::{FallbackConfig, FallbackSetup, TextOrAudioPipeline};
use tr_core::region::{RegionConfig, RegionPipeline, RegionProcessor};
use tr_core::runner::LoopTiming;
use tr_core::testing::FakeTranslator;
use tr_core::{AudioCapture, Clock, EventSink, Lang, OcrEngine, Region, Result, ScreenCapture};
use tr_core::{SpeechToText, Translator};

use crate::fake::{DemoAudio, DemoOcr, DemoScreen, DemoStt};

/// Conjunto de motores a usar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EngineKind {
    /// Motores de demostración deterministas (sin modelos).
    #[default]
    Fake,
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub engines: EngineKind,
    pub timing: LoopTiming,
    /// `Some` activa el paso automático a audio cuando no hay texto en la región.
    pub fallback: Option<FallbackConfig>,
    pub cache_capacity: usize,
    /// Ritmo real del audio de demostración (solo `EngineKind::Fake`).
    pub fake_audio_pace: Duration,
    /// Latencia simulada de OCR y STT de demostración (solo `EngineKind::Fake`).
    pub fake_latency: Duration,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            engines: EngineKind::default(),
            timing: LoopTiming::default(),
            fallback: None,
            cache_capacity: DEFAULT_CAPACITY,
            fake_audio_pace: Duration::from_millis(100),
            fake_latency: Duration::ZERO,
        }
    }
}

struct Components {
    screen: Box<dyn ScreenCapture>,
    ocr: Box<dyn OcrEngine>,
    audio: Box<dyn AudioCapture>,
    stt: Box<dyn SpeechToText>,
    translator: Arc<dyn Translator>,
}

fn components(config: &EngineConfig) -> Components {
    match config.engines {
        EngineKind::Fake => Components {
            screen: Box::new(DemoScreen::default()),
            ocr: Box::new(DemoOcr::new(config.fake_latency)),
            audio: Box::new(DemoAudio::new(config.fake_audio_pace)),
            stt: Box::new(DemoStt::new(config.fake_latency)),
            translator: Arc::new(FakeTranslator::new()),
        },
    }
}

enum Active {
    Text(RegionPipeline),
    Fallback(TextOrAudioPipeline),
    Audio(Box<AudioPipeline>),
}

pub struct Engine {
    config: EngineConfig,
    sink: Arc<dyn EventSink>,
    clock: Arc<dyn Clock>,
    active: Option<Active>,
}

impl Engine {
    pub fn new(config: EngineConfig, sink: Arc<dyn EventSink>) -> Self {
        Self {
            config,
            sink,
            clock: Arc::new(SystemClock::new()),
            active: None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.active.is_some()
    }

    /// Traduce el texto de una región. Si ya había algo en marcha, lo reemplaza.
    pub fn start_region(&mut self, region: Region, from: Lang, to: Lang) -> Result<()> {
        self.stop();
        let parts = components(&self.config);
        let cache = Arc::new(TranslationCache::new(self.config.cache_capacity));
        let processor = RegionProcessor::new(
            RegionConfig::new(from.clone(), to.clone()),
            parts.ocr,
            parts.translator.clone(),
            cache.clone(),
            self.sink.clone(),
            self.clock.clone(),
        );

        self.active = Some(match self.config.fallback {
            None => Active::Text(RegionPipeline::start(
                region,
                parts.screen,
                processor,
                self.sink.clone(),
                self.config.timing,
            )),
            Some(fallback) => {
                let audio_processor = AudioProcessor::new(
                    AudioConfig::new(from, to),
                    parts.stt,
                    parts.translator,
                    cache,
                    self.sink.clone(),
                    self.clock.clone(),
                );
                let audio = AudioRunner::new(parts.audio, audio_processor, self.sink.clone());
                Active::Fallback(TextOrAudioPipeline::start(
                    region,
                    FallbackSetup {
                        screen: parts.screen,
                        processor,
                        audio,
                        config: fallback,
                        timing: self.config.timing,
                    },
                    self.clock.clone(),
                    self.sink.clone(),
                ))
            }
        });
        Ok(())
    }

    /// Subtitula el audio del sistema. Si ya había algo en marcha, lo reemplaza.
    pub fn start_audio(&mut self, from: Lang, to: Lang) -> Result<()> {
        self.stop();
        let parts = components(&self.config);
        let processor = AudioProcessor::new(
            AudioConfig::new(from, to),
            parts.stt,
            parts.translator,
            Arc::new(TranslationCache::new(self.config.cache_capacity)),
            self.sink.clone(),
            self.clock.clone(),
        );
        let pipeline = AudioPipeline::start(parts.audio, processor, self.sink.clone())?;
        self.active = Some(Active::Audio(Box::new(pipeline)));
        Ok(())
    }

    /// Pausa pantalla y audio. Solo aplica a los pipelines de región.
    pub fn pause(&self) {
        match &self.active {
            Some(Active::Text(p)) => p.pause(),
            Some(Active::Fallback(p)) => p.pause(),
            _ => {}
        }
    }

    pub fn resume(&self) {
        match &self.active {
            Some(Active::Text(p)) => p.resume(),
            Some(Active::Fallback(p)) => p.resume(),
            _ => {}
        }
    }

    /// Detiene lo que esté en marcha y libera sus hilos; al volver no se emiten más eventos.
    /// Es idempotente.
    pub fn stop(&mut self) {
        match self.active.take() {
            Some(Active::Text(mut p)) => p.stop(),
            Some(Active::Fallback(mut p)) => p.stop(),
            Some(Active::Audio(mut p)) => p.stop(),
            None => {}
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}
