//! Capa napi-rs: expone a JS solo comandos de control y eventos de texto.
//!
//! API: `startRegionTranslation`, `startAudioSubtitles`, `stop`, `pause`, `resume`, `configure`,
//! `modelStatus`, `downloadModels`, `modelInventory`, `deleteModel`, `cancelModelDownload`,
//! `validateModelsDir`, `cacheStats`, `listAudioSources`, `audioVoiceThreshold`,
//! `startAudioMonitor`, `stopAudioMonitor` y los registros
//! `onTranslation`, `onSubtitle`, `onError`, `onModelProgress`, `onModeChanged`, `onAudioLevel`. Capturas y audio nunca cruzan hacia JS.
//!
//! Modos: `startRegionTranslation` con `autoFallback: true` es el modo automático (texto con paso
//! a audio) y es el único que emite `onModeChanged`; sin fallback es "solo texto" y
//! `startAudioSubtitles` es "solo audio": en ambos el llamador conoce el modo por la orden que dio.

mod events;
mod models;

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use napi::bindgen_prelude::AsyncTask;
use napi::{Error, Status};
use napi_derive::{module_init, napi};
use tr_engine::tr_core::fallback::FallbackConfig;
use tr_engine::tr_core::runner::LoopTiming;
use tr_engine::tr_core::{AudioSource, CoreError, ErrorCategory, Lang, Region, panic_hook};
use tr_engine::{
    Engine, EngineConfig, EngineKind, Manifest, ModelScope, Models, PerformanceConfig,
};

use events::{
    AudioLevelEvent, BindingSink, Callback, Callbacks, ErrorEvent, ModeEvent, ModelProgressEvent,
    SubtitleEvent, TranslationEvent,
};
use models::{DeleteTask, DownloadTask, InventoryTask, ModelCatalog, ModelsDirCheck, StatusTask};

static CALLBACKS: LazyLock<Arc<Callbacks>> = LazyLock::new(Arc::default);

fn new_engine(config: EngineConfig) -> Engine {
    Engine::new(config, Arc::new(BindingSink(CALLBACKS.clone())))
}

static ENGINE: LazyLock<Mutex<Engine>> =
    LazyLock::new(|| Mutex::new(new_engine(EngineConfig::default())));

/// Servicio de modelos de la configuración actual; se crea al primer uso y `configure` lo renueva
/// (así se conserva la caché de verificación entre llamadas).
static MODELS: LazyLock<Mutex<Option<Models>>> = LazyLock::new(|| Mutex::new(None));

fn engine() -> MutexGuard<'static, Engine> {
    ENGINE.lock().unwrap_or_else(PoisonError::into_inner)
}

fn models() -> napi::Result<Models> {
    let mut slot = MODELS.lock().unwrap_or_else(PoisonError::into_inner);
    if slot.is_none() {
        *slot = Some(engine().models().map_err(|e| to_napi(&e))?);
    }
    slot.clone()
        .ok_or_else(|| Error::new(Status::GenericFailure, "the models service is unavailable"))
}

#[module_init]
fn init() {
    // El mensaje de un pánico podría contener texto capturado: solo se informa el lugar.
    panic_hook::install_stderr();
}

/// Rectángulo de pantalla en píxeles físicos, relativo al monitor indicado.
#[napi(object)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Monitor (0 = principal).
    pub monitor: Option<u32>,
}

/// Parámetros de rendimiento; todos opcionales (sin valor, el motor usa los suyos).
#[napi(object)]
pub struct PerformanceOptions {
    /// Hilos de cálculo de cada sesión de ONNX Runtime (1 a 64).
    pub intra_threads: Option<u32>,
    /// Anchura del haz de la traducción (1 a 8; 1 = voraz).
    pub beam_width: Option<u32>,
    /// Entradas de la caché de traducciones (1 a 1 000 000).
    pub cache_capacity: Option<u32>,
    /// Lado máximo, en píxeles, con que el OCR detecta texto (160 a 4000; por defecto 960).
    /// Menos es más rápido y gasta menos RAM, pero puede perder letra pequeña.
    pub ocr_max_side: Option<u32>,
    /// Prioriza la RAM sobre la latencia (por defecto `false`).
    pub low_memory: Option<bool>,
}

/// Contadores de la caché de traducciones del motor actual (nunca contenido).
#[napi(object)]
pub struct CacheStatsInfo {
    pub hits: f64,
    pub misses: f64,
    pub inserts: f64,
    pub evictions: f64,
    /// Fracción de consultas que acertaron (0 a 1).
    pub hit_ratio: f64,
}

/// Opciones del motor; todas opcionales. Se aplican en el próximo arranque.
#[napi(object)]
pub struct EngineOptions {
    /// Conjunto de motores: `fake` (demostración, por defecto) o `real`.
    pub engines: Option<String>,
    /// Carpeta de modelos (ruta absoluta). Por defecto, la de datos del usuario.
    pub models_dir: Option<String>,
    /// Ruta de un manifiesto de modelos alternativo (JSON), p. ej. con un espejo propio. Avanzado.
    pub manifest_path: Option<String>,
    /// Milisegundos entre capturas de pantalla.
    pub frame_interval_ms: Option<u32>,
    /// Pasar a audio automáticamente cuando no hay texto en la región.
    pub auto_fallback: Option<bool>,
    /// Milisegundos sin texto antes de pasar a audio.
    pub fallback_no_text_ms: Option<u32>,
    /// Milisegundos con texto antes de volver a texto.
    pub fallback_text_ms: Option<u32>,
    /// Latencia simulada de los motores de demostración.
    pub fake_latency_ms: Option<u32>,
    /// Parámetros de rendimiento (hilos, haz, caché).
    pub performance: Option<PerformanceOptions>,
    /// Nivel RMS (0,001 a 0,5) a partir del cual el audio cuenta como voz. Por defecto, 0,01.
    pub voice_threshold: Option<f64>,
}

/// Convierte un error del núcleo: los argumentos inválidos se distinguen del resto de fallos.
pub(crate) fn to_napi(error: &CoreError) -> Error {
    let status = if error.category() == ErrorCategory::InvalidArgument {
        Status::InvalidArg
    } else {
        Status::GenericFailure
    };
    Error::new(status, error.to_string())
}

fn invalid_arg(message: impl Into<String>) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("invalid argument: {}", message.into()),
    )
}

fn languages(from: &str, to: &str) -> napi::Result<(Lang, Lang)> {
    let (from, to) = (
        Lang::new(from).map_err(|e| to_napi(&e))?,
        Lang::new(to).map_err(|e| to_napi(&e))?,
    );
    if from == to {
        return Err(invalid_arg("source and target languages must differ"));
    }
    Ok((from, to))
}

fn load_manifest(path: &str) -> napi::Result<Arc<Manifest>> {
    let text = std::fs::read_to_string(Path::new(path))
        .map_err(|e| invalid_arg(format!("could not read the manifest `{path}`: {e}")))?;
    Manifest::parse(&text)
        .map(Arc::new)
        .map_err(|e| invalid_arg(e.to_string()))
}

/// Valida un campo numérico opcional contra su rango.
fn ranged(value: Option<u32>, label: &str, min: u32, max: u32) -> napi::Result<Option<usize>> {
    match value {
        None => Ok(None),
        Some(v) if (min..=max).contains(&v) => Ok(Some(v as usize)),
        Some(_) => Err(invalid_arg(format!(
            "{label} must be between {min} and {max}"
        ))),
    }
}

/// Aplica los parámetros de rendimiento a la configuración. `cacheCapacity` ya lo usa el motor;
/// `intraThreads` y `beamWidth` quedan en `EngineConfig.performance` para los adaptadores (5A);
/// `ocrMaxSide` y `lowMemory` van a `EngineConfig.perf`.
fn apply_performance(
    config: &mut EngineConfig,
    performance: &PerformanceOptions,
) -> napi::Result<()> {
    let intra_threads = ranged(performance.intra_threads, "performance.intraThreads", 1, 64)?;
    let beam_width = ranged(performance.beam_width, "performance.beamWidth", 1, 8)?;
    let cache = ranged(
        performance.cache_capacity,
        "performance.cacheCapacity",
        1,
        1_000_000,
    )?;
    let ocr_max_side = ranged(
        performance.ocr_max_side,
        "performance.ocrMaxSide",
        160,
        4000,
    )?;
    config.performance = PerformanceConfig {
        intra_threads,
        beam_width,
    };
    if let Some(capacity) = cache {
        config.cache_capacity = capacity;
    }
    if let Some(side) = ocr_max_side {
        // Validado en 160..=4000: cabe en u32.
        config.perf.ocr_max_side = side as u32;
    }
    if let Some(low_memory) = performance.low_memory {
        config.perf.low_memory = low_memory;
    }
    Ok(())
}

/// Contadores de la caché de traducciones del motor actual (solo números). Se reinician con
/// `configure`, que crea un motor nuevo.
#[napi]
pub fn cache_stats() -> CacheStatsInfo {
    let stats = engine().cache_stats();
    CacheStatsInfo {
        hits: stats.hits as f64,
        misses: stats.misses as f64,
        inserts: stats.inserts as f64,
        evictions: stats.evictions as f64,
        hit_ratio: stats.hit_ratio(),
    }
}

/// Construye la configuración validando **todo** antes de tocar el estado del motor.
fn build_config(options: &EngineOptions) -> napi::Result<EngineConfig> {
    let ms = |v: u32| Duration::from_millis(u64::from(v));
    let mut config = EngineConfig::default();

    if let Some(name) = &options.engines {
        config.engines = name.parse::<EngineKind>().map_err(|e| to_napi(&e))?;
    }
    if let Some(dir) = &options.models_dir {
        let path = PathBuf::from(dir);
        if !path.is_absolute() {
            return Err(invalid_arg("modelsDir must be an absolute path"));
        }
        config.models_dir = Some(path);
    }
    if let Some(path) = &options.manifest_path {
        config.manifest = Some(load_manifest(path)?);
    }
    if let Some(interval) = options.frame_interval_ms {
        config.timing = LoopTiming {
            interval: ms(interval),
            idle_interval: ms(interval).max(config.timing.idle_interval),
        };
    }
    if options.auto_fallback == Some(true) {
        let defaults = FallbackConfig::default();
        config.fallback = Some(FallbackConfig {
            no_text_for: options.fallback_no_text_ms.map_or(defaults.no_text_for, ms),
            text_for: options.fallback_text_ms.map_or(defaults.text_for, ms),
        });
    }
    if let Some(latency) = options.fake_latency_ms {
        config.fake_latency = ms(latency);
    }
    if let Some(performance) = &options.performance {
        apply_performance(&mut config, performance)?;
    }
    if let Some(threshold) = options.voice_threshold {
        if !(0.001..=0.5).contains(&threshold) {
            return Err(invalid_arg("voiceThreshold must be between 0.001 and 0.5"));
        }
        config.vad_threshold = threshold as f32;
    }
    Ok(config)
}

/// Aplica opciones al motor. Si alguna es inválida falla sin cambiar nada; si todas lo son,
/// detiene lo que esté en marcha, salvo la escucha previa del nivel (`startAudioMonitor`), que
/// pasa al motor nuevo: no es una sesión y cambiar los ajustes no debe apagarla en silencio.
#[napi]
pub fn configure(options: EngineOptions) -> napi::Result<()> {
    let config = build_config(&options)?;
    let mut next = new_engine(config);
    {
        let mut current = engine();
        next.adopt_monitor_from(&mut current);
        *current = next;
    }
    let previous = MODELS.lock().unwrap_or_else(PoisonError::into_inner).take();
    if let Some(previous) = previous {
        previous.cancel();
    }
    Ok(())
}

/// Traduce el texto de una región de la pantalla. Reemplaza lo que estuviera en marcha.
#[napi]
pub fn start_region_translation(rect: Rect, from: String, to: String) -> napi::Result<()> {
    let (from, to) = languages(&from, &to)?;
    let region = Region::new(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.monitor.unwrap_or(0),
    )
    .map_err(|e| to_napi(&e))?;
    engine()
        .start_region(region, from, to)
        .map_err(|e| to_napi(&e))
}

/// Fuente de audio: `{ kind: 'system' }` o `{ kind: 'app', id, name }`.
#[napi(object)]
pub struct AudioSourceInput {
    /// `system` (todo el sistema) o `app` (una aplicación).
    pub kind: String,
    /// Identificador de proceso de la aplicación (solo `app`).
    pub id: Option<u32>,
    /// Nombre del programa (solo `app`).
    pub name: Option<String>,
}

/// Aplicación con audio activo.
#[napi(object)]
pub struct AudioAppInfo {
    pub id: u32,
    pub name: String,
}

/// Resultado de `listAudioSources`: con `supported: true` trae `apps`; si no, el motivo.
#[napi(object)]
pub struct AudioSourceList {
    pub supported: bool,
    pub apps: Option<Vec<AudioAppInfo>>,
    pub reason: Option<String>,
}

fn audio_source(input: Option<AudioSourceInput>) -> napi::Result<AudioSource> {
    let Some(input) = input else {
        return Ok(AudioSource::System);
    };
    match input.kind.as_str() {
        "system" => Ok(AudioSource::System),
        "app" => match input.id {
            Some(id) => Ok(AudioSource::Process {
                id,
                name: input.name.unwrap_or_default(),
            }),
            None => Err(invalid_arg("an application source needs an id")),
        },
        other => Err(invalid_arg(format!(
            "unknown audio source kind `{other}` (use `system` or `app`)"
        ))),
    }
}

/// Subtitula el audio de `source` (por defecto, todo el sistema). Reemplaza lo que estuviera en marcha.
#[napi]
pub fn start_audio_subtitles(
    from: String,
    to: String,
    source: Option<AudioSourceInput>,
) -> napi::Result<()> {
    let (from, to) = languages(&from, &to)?;
    let source = audio_source(source)?;
    engine()
        .start_audio(from, to, source)
        .map_err(|e| to_napi(&e))
}

/// Escucha `source` (por defecto, todo el sistema) solo para medir su nivel: `onAudioLevel` recibe un
/// nivel por trozo de 100 ms, sin modelos, sin reconocer voz ni traducir y sin conservar el audio.
/// Reemplaza una escucha anterior. Devuelve `false`, sin abrir nada, si hay una sesión en marcha:
/// la escucha cede ante ella. Si la fuente no se puede abrir falla con el motivo.
#[napi]
pub fn start_audio_monitor(source: Option<AudioSourceInput>) -> napi::Result<bool> {
    let source = audio_source(source)?;
    engine()
        .start_audio_monitor(source)
        .map_err(|e| to_napi(&e))
}

/// Detiene la escucha previa; después no llegan más niveles de ella. Idempotente.
#[napi]
pub fn stop_audio_monitor() {
    engine().stop_audio_monitor();
}

/// Aplicaciones que reproducen audio ahora. Síncrona; si la plataforma no puede listarlas devuelve
/// `supported: false` con el motivo.
#[napi]
pub fn list_audio_sources() -> AudioSourceList {
    match engine().list_audio_sources() {
        Ok(apps) => AudioSourceList {
            supported: true,
            apps: Some(
                apps.into_iter()
                    .map(|app| AudioAppInfo {
                        id: app.id,
                        name: app.name,
                    })
                    .collect(),
            ),
            reason: None,
        },
        Err(error) => AudioSourceList {
            supported: false,
            apps: None,
            reason: Some(error.to_string()),
        },
    }
}

/// Nivel RMS a partir del cual el motor considera que hay voz (de 0 a 1). Única fuente de verdad
/// para la marca de la barra de nivel.
#[napi]
pub fn audio_voice_threshold() -> f64 {
    f64::from(engine().voice_threshold())
}

/// Detiene el motor y espera a que terminen sus hilos: no se producen más eventos. Los que ya
/// estaban en cola hacia JS pueden entregarse enseguida; `api.js` los descarta. Idempotente.
#[napi]
pub fn stop() {
    engine().stop();
}

/// Pausa la captura (y el audio, si lo hay). No hace nada si no hay una traducción de región en marcha.
#[napi]
pub fn pause() {
    engine().pause();
}

/// Reanuda tras una pausa, en el modo previo.
#[napi]
pub fn resume() {
    engine().resume();
}

/// Idiomas y pares disponibles según el manifiesto de modelos.
#[napi]
pub fn model_catalog() -> napi::Result<ModelCatalog> {
    Ok(models()?.catalog().into())
}

/// Qué modelos se consultan: `text` (OCR + traducción, por defecto), `audio` (voz + traducción) o `all`.
fn scope(name: Option<&str>) -> napi::Result<ModelScope> {
    name.map_or(Ok(ModelScope::Text), |n| {
        n.parse::<ModelScope>().map_err(|e| to_napi(&e))
    })
}

/// Estado de los modelos necesarios para `from` -> `to` (`scope`: `text`, `audio` o `all`).
#[napi(ts_return_type = "Promise<Array<ModelStatusInfo>>")]
pub fn model_status(
    from: String,
    to: String,
    scope_name: Option<String>,
) -> napi::Result<AsyncTask<StatusTask>> {
    let (from, to) = languages(&from, &to)?;
    Ok(AsyncTask::new(StatusTask {
        models: models()?,
        from,
        to,
        scope: scope(scope_name.as_deref())?,
    }))
}

/// Descarga los modelos que falten para el par (`scope`: `text`, `audio` o `all`); el avance llega
/// por `onModelProgress`.
#[napi(ts_return_type = "Promise<void>")]
pub fn download_models(
    from: String,
    to: String,
    scope_name: Option<String>,
) -> napi::Result<AsyncTask<DownloadTask>> {
    let (from, to) = languages(&from, &to)?;
    Ok(AsyncTask::new(DownloadTask {
        models: models()?,
        from,
        to,
        scope: scope(scope_name.as_deref())?,
    }))
}

/// Todos los modelos del manifiesto con su estado y el espacio que ocupan en disco.
#[napi(ts_return_type = "Promise<ModelInventory>")]
pub fn model_inventory() -> napi::Result<AsyncTask<InventoryTask>> {
    Ok(AsyncTask::new(InventoryTask { models: models()? }))
}

/// Borra un modelo por su identificador y devuelve los bytes liberados. Se rechaza mientras haya
/// una traducción en marcha (los modelos están en uso) o el modelo se esté descargando.
#[napi(ts_return_type = "Promise<number>")]
pub fn delete_model(id: String) -> napi::Result<AsyncTask<DeleteTask>> {
    if engine().is_running() {
        return Err(Error::new(
            Status::GenericFailure,
            "a translation is running; stop it before deleting models",
        ));
    }
    Ok(AsyncTask::new(DeleteTask {
        models: models()?,
        id,
    }))
}

/// Interrumpe la descarga de modelos en curso; lo descargado se conserva para reanudar.
#[napi]
pub fn cancel_model_download() -> napi::Result<()> {
    models()?.cancel();
    Ok(())
}

/// Comprueba si `path` sirve como carpeta de modelos (absoluta, escribible...).
#[napi]
pub fn validate_models_dir(path: String) -> ModelsDirCheck {
    match Models::validate_dir(Path::new(&path)) {
        Ok(()) => ModelsDirCheck {
            ok: true,
            reason: None,
        },
        Err(problem) => ModelsDirCheck {
            ok: false,
            reason: Some(problem.code().to_owned()),
        },
    }
}

/// Uso interno de `api.js`: cuántos eventos de progreso de modelos se han emitido en total.
#[napi]
pub fn progress_events_emitted() -> f64 {
    events::model_progress_emitted() as f64
}

#[napi(ts_args_type = "callback: (event: TranslationEvent) => void")]
pub fn on_translation(callback: Callback<TranslationEvent>) {
    CALLBACKS.translation.set(callback);
}

#[napi(ts_args_type = "callback: (event: SubtitleEvent) => void")]
pub fn on_subtitle(callback: Callback<SubtitleEvent>) {
    CALLBACKS.subtitle.set(callback);
}

#[napi(ts_args_type = "callback: (event: ErrorEvent) => void")]
pub fn on_error(callback: Callback<ErrorEvent>) {
    CALLBACKS.error.set(callback);
}

#[napi(ts_args_type = "callback: (event: ModelProgressEvent) => void")]
pub fn on_model_progress(callback: Callback<ModelProgressEvent>) {
    CALLBACKS.model_progress.set(callback);
}

#[napi(ts_args_type = "callback: (event: ModeEvent) => void")]
pub fn on_mode_changed(callback: Callback<ModeEvent>) {
    CALLBACKS.mode.set(callback);
}

#[napi(ts_args_type = "callback: (event: AudioLevelEvent) => void")]
pub fn on_audio_level(callback: Callback<AudioLevelEvent>) {
    CALLBACKS.level.set(callback);
}
