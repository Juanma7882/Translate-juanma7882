//! Tipos de eventos expuestos a JS y el sumidero que los entrega.
//!
//! Solo cruzan texto y metadatos; nunca píxeles ni audio.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use napi::Status;
use napi::bindgen_prelude::JsValuesTupleIntoVec;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use tr_engine::tr_core::{Event, EventSink, Mode, Translated};

/// Callback de JS con argumentos directos (sin convención `(err, valor)`) y referencia débil:
/// no mantiene vivo el bucle de eventos de Node.
pub type Callback<T> = ThreadsafeFunction<T, (), T, Status, false, true>;

/// La traducción de un texto a un idioma de destino.
#[napi(object)]
pub struct TranslationText {
    pub lang: String,
    pub text: String,
}

#[napi(object)]
pub struct TranslationEvent {
    pub original: String,
    /// Una entrada por destino traducido, en el orden de los destinos (vacía sin destinos).
    pub translations: Vec<TranslationText>,
    /// Milisegundos desde el inicio del motor.
    pub timestamp_ms: f64,
}

#[napi(object)]
pub struct SubtitleEvent {
    pub original: String,
    /// Vacía en parciales, sin destinos y cuando fallaron todas las traducciones.
    pub translations: Vec<TranslationText>,
    pub is_final: bool,
    pub timestamp_ms: f64,
}

#[napi(object)]
pub struct ErrorEvent {
    /// `invalid-argument`, `capture`, `ocr`, `stt`, `translation` o `model`.
    pub category: String,
    pub message: String,
}

#[napi(object)]
pub struct ModelProgressEvent {
    pub model: String,
    pub downloaded: f64,
    pub total: Option<f64>,
}

#[napi(object)]
pub struct ModeEvent {
    /// `text`, `audio` o `paused`.
    pub mode: String,
}

/// Nivel del último trozo de audio (de 0 a 1). Solo números.
#[napi(object)]
pub struct AudioLevelEvent {
    pub rms: f64,
    pub peak: f64,
}

/// Aviso de que la región se quedó sin texto. `cleared` es siempre `true`; no hay contenido.
#[napi(object)]
pub struct TextClearedEvent {
    pub cleared: bool,
}

/// Un callback por tipo de evento; registrar otro reemplaza al anterior.
#[derive(Default)]
pub struct Callbacks {
    pub translation: Slot<TranslationEvent>,
    pub subtitle: Slot<SubtitleEvent>,
    pub error: Slot<ErrorEvent>,
    pub model_progress: Slot<ModelProgressEvent>,
    pub mode: Slot<ModeEvent>,
    pub level: Slot<AudioLevelEvent>,
    pub text_cleared: Slot<TextClearedEvent>,
}

pub struct Slot<T: 'static + JsValuesTupleIntoVec>(Mutex<Option<Callback<T>>>);

impl<T: 'static + JsValuesTupleIntoVec> Default for Slot<T> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T: 'static + JsValuesTupleIntoVec> Slot<T> {
    fn lock(&self) -> MutexGuard<'_, Option<Callback<T>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set(&self, callback: Callback<T>) {
        *self.lock() = Some(callback);
    }

    /// Entrega sin bloquear; si nadie se suscribió, el evento se descarta.
    fn deliver(&self, value: T) {
        if let Some(callback) = self.lock().as_ref() {
            callback.call(value, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}

fn texts(translations: Vec<Translated>) -> Vec<TranslationText> {
    translations
        .into_iter()
        .map(|t| TranslationText {
            lang: t.lang.to_string(),
            text: t.text,
        })
        .collect()
}

fn millis(timestamp: Duration) -> f64 {
    timestamp.as_secs_f64() * 1000.0
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Text => "text",
        Mode::Audio => "audio",
        Mode::Paused => "paused",
    }
}

/// Convierte los eventos del núcleo y los entrega a los callbacks registrados.
pub struct BindingSink(pub Arc<Callbacks>);

/// Eventos de progreso de modelos emitidos desde el arranque del proceso. `api.js` lo usa para
/// saber cuántos le faltan por recibir: la promesa de una descarga y sus eventos viajan por
/// canales distintos hacia JS y no llegan necesariamente en orden.
static MODEL_PROGRESS_EMITTED: AtomicU64 = AtomicU64::new(0);

pub fn model_progress_emitted() -> u64 {
    MODEL_PROGRESS_EMITTED.load(Ordering::Acquire)
}

impl EventSink for BindingSink {
    fn emit(&self, event: Event) {
        let callbacks = &self.0;
        if matches!(event, Event::ModelProgress { .. }) {
            MODEL_PROGRESS_EMITTED.fetch_add(1, Ordering::AcqRel);
        }
        match event {
            Event::Translation {
                original,
                translations,
                timestamp,
            } => callbacks.translation.deliver(TranslationEvent {
                original,
                translations: texts(translations),
                timestamp_ms: millis(timestamp),
            }),
            Event::Subtitle {
                original,
                translations,
                is_final,
                timestamp,
            } => callbacks.subtitle.deliver(SubtitleEvent {
                original,
                translations: texts(translations),
                is_final,
                timestamp_ms: millis(timestamp),
            }),
            Event::Error { category, message } => callbacks.error.deliver(ErrorEvent {
                category: category.as_str().to_owned(),
                message,
            }),
            Event::ModelProgress {
                model,
                downloaded,
                total,
            } => callbacks.model_progress.deliver(ModelProgressEvent {
                model,
                downloaded: downloaded as f64,
                total: total.map(|t| t as f64),
            }),
            Event::ModeChanged { mode } => callbacks.mode.deliver(ModeEvent {
                mode: mode_name(mode).to_owned(),
            }),
            Event::TextCleared => callbacks
                .text_cleared
                .deliver(TextClearedEvent { cleared: true }),
            Event::AudioLevel { rms, peak } => callbacks.level.deliver(AudioLevelEvent {
                rms: f64::from(rms),
                peak: f64::from(peak),
            }),
        }
    }
}
