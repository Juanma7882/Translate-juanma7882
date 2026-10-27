//! Capa napi-rs: expone a JS solo comandos de control y eventos de texto.
//!
//! API: `startRegionTranslation`, `startAudioSubtitles`, `stop`, `configure` y los
//! registros `onTranslation`, `onSubtitle`, `onError`, `onModelProgress`, `onModeChanged`.
//! Capturas y audio nunca cruzan hacia JS.

mod events;

use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use napi::{Error, Status};
use napi_derive::{module_init, napi};
use tr_engine::tr_core::fallback::FallbackConfig;
use tr_engine::tr_core::runner::LoopTiming;
use tr_engine::tr_core::{CoreError, Lang, Region, panic_hook};
use tr_engine::{Engine, EngineConfig};

use events::{
    BindingSink, Callback, Callbacks, ErrorEvent, ModeEvent, ModelProgressEvent, SubtitleEvent,
    TranslationEvent,
};

static CALLBACKS: LazyLock<Arc<Callbacks>> = LazyLock::new(Arc::default);

fn new_engine(config: EngineConfig) -> Engine {
    Engine::new(config, Arc::new(BindingSink(CALLBACKS.clone())))
}

static ENGINE: LazyLock<Mutex<Engine>> =
    LazyLock::new(|| Mutex::new(new_engine(EngineConfig::default())));

fn engine() -> MutexGuard<'static, Engine> {
    ENGINE.lock().unwrap_or_else(PoisonError::into_inner)
}

#[module_init]
fn init() {
    // El mensaje de un pánico podría contener texto capturado: solo se informa el lugar.
    panic_hook::install_stderr();
}

/// Rectángulo de pantalla en píxeles físicos.
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

fn invalid(error: &CoreError) -> Error {
    Error::new(Status::InvalidArg, error.to_string())
}

fn failure(error: &CoreError) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

fn languages(from: &str, to: &str) -> napi::Result<(Lang, Lang)> {
    let (from, to) = (
        Lang::new(from).map_err(|e| invalid(&e))?,
        Lang::new(to).map_err(|e| invalid(&e))?,
    );
    if from == to {
        return Err(Error::new(
            Status::InvalidArg,
            "invalid argument: source and target languages must differ",
        ));
    }
    Ok((from, to))
}

/// Aplica opciones al motor. Detiene lo que esté en marcha.
#[napi]
pub fn configure(options: EngineOptions) -> napi::Result<()> {
    let ms = |v: u32| Duration::from_millis(u64::from(v));
    let mut config = EngineConfig::default();
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
    *engine() = new_engine(config);
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
    .map_err(|e| invalid(&e))?;
    engine()
        .start_region(region, from, to)
        .map_err(|e| failure(&e))
}

/// Subtitula el audio del sistema. Reemplaza lo que estuviera en marcha.
#[napi]
pub fn start_audio_subtitles(from: String, to: String) -> napi::Result<()> {
    let (from, to) = languages(&from, &to)?;
    engine().start_audio(from, to).map_err(|e| failure(&e))
}

/// Detiene el motor y espera a que terminen sus hilos: no se producen más eventos. Los que ya
/// estaban en cola hacia JS pueden entregarse enseguida; `api.js` los descarta. Idempotente.
#[napi]
pub fn stop() {
    engine().stop();
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
