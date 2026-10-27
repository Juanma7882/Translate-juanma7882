//! Capa napi-rs: expone a JS solo comandos de control y eventos de texto.
//!
//! API: `startRegionTranslation`, `startAudioSubtitles`, `stop`, `pause`, `resume`, `configure`,
//! `modelStatus`, `downloadModels` y los registros `onTranslation`, `onSubtitle`, `onError`,
//! `onModelProgress`, `onModeChanged`. Capturas y audio nunca cruzan hacia JS.

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
use tr_engine::tr_core::{CoreError, ErrorCategory, Lang, Region, panic_hook};
use tr_engine::{Engine, EngineConfig, EngineKind, Manifest, ModelScope, Models};

use events::{
    BindingSink, Callback, Callbacks, ErrorEvent, ModeEvent, ModelProgressEvent, SubtitleEvent,
    TranslationEvent,
};
use models::{DownloadTask, ModelCatalog, StatusTask};

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
    Ok(config)
}

/// Aplica opciones al motor. Si alguna es inválida falla sin cambiar nada; si todas lo son,
/// detiene lo que esté en marcha.
#[napi]
pub fn configure(options: EngineOptions) -> napi::Result<()> {
    let config = build_config(&options)?;
    *engine() = new_engine(config);
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

/// Subtitula el audio del sistema. Reemplaza lo que estuviera en marcha.
#[napi]
pub fn start_audio_subtitles(from: String, to: String) -> napi::Result<()> {
    let (from, to) = languages(&from, &to)?;
    engine().start_audio(from, to).map_err(|e| to_napi(&e))
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
