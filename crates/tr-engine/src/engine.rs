//! Composition root: arma los pipelines a partir de la configuración.
//!
//! Es el único lugar que conoce a la vez el núcleo, los modelos y los adaptadores. Agregar un
//! motor es agregar un adaptador y una línea aquí; `tr-core` no cambia.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use tr_adapters::perf::PerfConfig;
use tr_core::Clock;
use tr_core::audio::{AudioConfig, AudioPipeline, AudioProcessor, AudioRunner};
use tr_core::cache::{DEFAULT_CAPACITY, TranslationCache};
use tr_core::clock::SystemClock;
use tr_core::fallback::{FallbackConfig, FallbackSetup, TextOrAudioPipeline};
use tr_core::region::{RegionConfig, RegionPipeline, RegionProcessor};
use tr_core::runner::LoopTiming;
use tr_core::testing::FakeTranslator;
use tr_core::{CoreError, EventSink, Lang, Region, Result, Translator};

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

/// Parámetros de rendimiento que llegan desde la interfaz. `None` = valor por defecto del motor.
/// Se aplican sobre [`EngineConfig::perf`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PerformanceConfig {
    /// Hilos de cálculo de cada sesión de ONNX Runtime (`intra_threads`).
    pub intra_threads: Option<usize>,
    /// Anchura del haz de la búsqueda de la traducción (1 = voraz).
    pub beam_width: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub engines: EngineKind,
    pub timing: LoopTiming,
    /// `Some` activa el paso automático a audio cuando no hay texto en la región.
    pub fallback: Option<FallbackConfig>,
    pub cache_capacity: usize,
    /// Parámetros de rendimiento opcionales (hilos, haz) que llegan desde la interfaz.
    pub performance: PerformanceConfig,
    /// Afinación base de los motores (lado de detección del OCR, modo de poca memoria...);
    /// `performance` la sobrescribe donde trae valor. Ver `docs/adr/0006-rendimiento.md`.
    pub perf: PerfConfig,
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
            performance: PerformanceConfig::default(),
            perf: PerfConfig::default(),
            models_dir: None,
            manifest: None,
            fake_audio_pace: Duration::from_millis(100),
            fake_latency: Duration::ZERO,
        }
    }
}

impl EngineConfig {
    /// El manifiesto configurado o, por defecto, el incluido en el binario.
    /// Afinación efectiva de los motores: la base más lo que pidió la interfaz.
    pub fn perf_config(&self) -> PerfConfig {
        let mut perf = self.perf;
        if let Some(threads) = self.performance.intra_threads {
            perf.intra_threads = threads;
        }
        if let Some(beam) = self.performance.beam_width {
            perf.beam_size = beam;
        }
        perf
    }

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
        EngineKind::Real => real::region_parts(
            config.models_dir.clone(),
            config.manifest(),
            from,
            to,
            &config.perf_config(),
        ),
    }
}

/// `shared_translator` (el del fallback) evita cargar dos veces el modelo de traducción.
fn audio_parts(
    config: &EngineConfig,
    from: &Lang,
    to: &Lang,
    shared_translator: Option<Arc<dyn Translator>>,
) -> Result<AudioParts> {
    match config.engines {
        EngineKind::Fake => Ok(AudioParts {
            audio: Box::new(DemoAudio::new(config.fake_audio_pace)),
            stt: Box::new(DemoStt::new(config.fake_latency)),
            translator: shared_translator.unwrap_or_else(|| Arc::new(FakeTranslator::new())),
        }),
        EngineKind::Real => real::audio_parts(
            config.models_dir.clone(),
            config.manifest(),
            from,
            to,
            shared_translator,
            &config.perf_config(),
        ),
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
    /// Una sola caché para toda la vida del motor: sobrevive a pausas, cambios de modo y
    /// reinicios de sesión (la clave ya incluye el par de idiomas).
    cache: Arc<TranslationCache>,
}

impl Engine {
    pub fn new(config: EngineConfig, sink: Arc<dyn EventSink>) -> Self {
        let cache = Arc::new(TranslationCache::new(config.cache_capacity));
        Self {
            config,
            sink,
            clock: Arc::new(SystemClock::new()),
            active: None,
            cache,
        }
    }

    /// Contadores de la caché de traducciones (solo números).
    pub fn cache_stats(&self) -> tr_core::cache::CacheStats {
        self.cache.stats()
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
        // Con fallback real, todo lo que falte (texto y audio) se informa de una vez.
        if self.config.fallback.is_some() && self.config.engines == EngineKind::Real {
            real::ensure_fallback_ready(
                self.config.models_dir.clone(),
                self.config.manifest(),
                &from,
                &to,
            )?;
        }
        let parts = region_parts(&self.config, &from, &to)?;
        let audio = match self.config.fallback {
            Some(_) => Some(audio_parts(
                &self.config,
                &from,
                &to,
                Some(parts.translator.clone()),
            )?),
            None => None,
        };
        self.stop();

        let cache = Arc::clone(&self.cache);
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
        let parts = audio_parts(&self.config, &from, &to, None)?;
        self.stop();
        let processor = AudioProcessor::new(
            AudioConfig::new(from, to),
            parts.stt,
            parts.translator,
            Arc::clone(&self.cache),
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
