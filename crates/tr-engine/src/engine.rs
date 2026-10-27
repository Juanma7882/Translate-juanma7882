//! Composition root: arma los pipelines a partir de la configuración.
//!
//! Es el único lugar que conoce a la vez el núcleo, los modelos y los adaptadores. Agregar un
//! motor es agregar un adaptador y una línea aquí; `tr-core` no cambia.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use tr_core::Clock;
use tr_core::audio::{AudioConfig, AudioPipeline, AudioProcessor, AudioRunner};
use tr_core::cache::{DEFAULT_CAPACITY, TranslationCache};
use tr_core::clock::SystemClock;
use tr_core::fallback::{FallbackConfig, FallbackSetup, TextOrAudioPipeline};
use tr_core::region::{RegionConfig, RegionPipeline, RegionProcessor};
use tr_core::runner::LoopTiming;
use tr_core::testing::FakeTranslator;
use tr_core::{CoreError, EventSink, Lang, Region, Result};

use crate::fake::{DemoAudio, DemoOcr, DemoScreen, DemoStt};
use tr_models::Manifest;

use crate::models::Models;
use crate::real::{self, AudioParts, RegionParts};

/// Conjunto de motores a usar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EngineKind {
    /// Motores de demostración deterministas (sin modelos).
    #[default]
    Fake,
    /// Captura de pantalla, OCR y traducción reales (necesitan los modelos descargados).
    Real,
}

impl FromStr for EngineKind {
    type Err = CoreError;

    fn from_str(name: &str) -> Result<Self> {
        match name {
            "fake" => Ok(Self::Fake),
            "real" => Ok(Self::Real),
            other => Err(CoreError::InvalidArgument(format!(
                "unknown engine set `{other}` (use `fake` or `real`)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub engines: EngineKind,
    pub timing: LoopTiming,
    /// `Some` activa el paso automático a audio cuando no hay texto en la región.
    pub fallback: Option<FallbackConfig>,
    pub cache_capacity: usize,
    /// Carpeta de modelos; por defecto la de datos del usuario según el sistema.
    pub models_dir: Option<PathBuf>,
    /// Manifiesto de modelos alternativo (por ejemplo, con un espejo propio). `None` usa el incluido.
    pub manifest: Option<Arc<Manifest>>,
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
            models_dir: None,
            manifest: None,
            fake_audio_pace: Duration::from_millis(100),
            fake_latency: Duration::ZERO,
        }
    }
}

impl EngineConfig {
    /// El manifiesto configurado o, por defecto, el incluido en el binario.
    fn manifest(&self) -> &Manifest {
        self.manifest
            .as_deref()
            .unwrap_or_else(|| Manifest::embedded())
    }
}

fn region_parts(config: &EngineConfig, from: &Lang, to: &Lang) -> Result<RegionParts> {
    match config.engines {
        EngineKind::Fake => Ok(RegionParts {
            screen: Box::new(DemoScreen::default()),
            ocr: Box::new(DemoOcr::new(config.fake_latency)),
            translator: Arc::new(FakeTranslator::new()),
        }),
        EngineKind::Real => {
            real::region_parts(config.models_dir.clone(), config.manifest(), from, to)
        }
    }
}

fn audio_parts(config: &EngineConfig, from: &Lang, to: &Lang) -> Result<AudioParts> {
    match config.engines {
        EngineKind::Fake => Ok(AudioParts {
            audio: Box::new(DemoAudio::new(config.fake_audio_pace)),
            stt: Box::new(DemoStt::new(config.fake_latency)),
            translator: Arc::new(FakeTranslator::new()),
        }),
        EngineKind::Real => {
            real::audio_parts(config.models_dir.clone(), config.manifest(), from, to)
        }
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

    /// Servicio de modelos con la carpeta y el sumidero de este motor.
    pub fn models(&self) -> Result<Models> {
        let manifest = Arc::new(self.config.manifest().clone());
        Models::with_manifest(self.config.models_dir.clone(), manifest, self.sink.clone())
    }

    /// Traduce el texto de una región. Si ya había algo en marcha, lo reemplaza; si el arranque
    /// falla (modelos ausentes, motor no compilado...) lo anterior sigue funcionando.
    pub fn start_region(&mut self, region: Region, from: Lang, to: Lang) -> Result<()> {
        let parts = region_parts(&self.config, &from, &to)?;
        let audio = match self.config.fallback {
            Some(_) => Some(audio_parts(&self.config, &from, &to)?),
            None => None,
        };
        self.stop();

        let cache = Arc::new(TranslationCache::new(self.config.cache_capacity));
        let processor = RegionProcessor::new(
            RegionConfig::new(from.clone(), to.clone()),
            parts.ocr,
            parts.translator.clone(),
            cache.clone(),
            self.sink.clone(),
            self.clock.clone(),
        );

        self.active = Some(match (self.config.fallback, audio) {
            (Some(fallback), Some(audio)) => {
                let audio_processor = AudioProcessor::new(
                    AudioConfig::new(from, to),
                    audio.stt,
                    audio.translator,
                    cache,
                    self.sink.clone(),
                    self.clock.clone(),
                );
                let runner = AudioRunner::new(audio.audio, audio_processor, self.sink.clone());
                Active::Fallback(TextOrAudioPipeline::start(
                    region,
                    FallbackSetup {
                        screen: parts.screen,
                        processor,
                        audio: runner,
                        config: fallback,
                        timing: self.config.timing,
                    },
                    self.clock.clone(),
                    self.sink.clone(),
                ))
            }
            _ => Active::Text(RegionPipeline::start(
                region,
                parts.screen,
                processor,
                self.sink.clone(),
                self.config.timing,
            )),
        });
        Ok(())
    }

    /// Subtitula el audio del sistema. Si ya había algo en marcha, lo reemplaza.
    pub fn start_audio(&mut self, from: Lang, to: Lang) -> Result<()> {
        let parts = audio_parts(&self.config, &from, &to)?;
        self.stop();
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
