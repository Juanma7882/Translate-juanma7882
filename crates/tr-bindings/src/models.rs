//! Estado y descarga de modelos expuestos a JS como tareas asíncronas (promesas).
//!
//! Se ejecutan en el pool de hilos de libuv, así que el hilo de JS nunca espera a la red ni al
//! cálculo de huellas.

use napi::{Env, Task};
use napi_derive::napi;
use tr_engine::tr_core::Lang;
use tr_engine::{Catalog, ModelScope, ModelState, ModelStatus, Models};

use crate::to_napi;

#[napi(object)]
pub struct ModelStatusInfo {
    pub id: String,
    /// `missing`, `downloading` o `ready`.
    pub state: String,
    /// Tamaño total de los archivos del modelo, en bytes.
    pub size: f64,
}

#[napi(object)]
pub struct LangPair {
    pub from: String,
    pub to: String,
}

/// Idiomas y pares para los que hay modelos (lo que la interfaz puede ofrecer).
#[napi(object)]
pub struct ModelCatalog {
    /// Idiomas que el OCR sabe reconocer.
    pub ocr_languages: Vec<String>,
    /// Idiomas que el reconocimiento de voz sabe transcribir (subtítulos del audio).
    pub stt_languages: Vec<String>,
    /// Pares de traducción disponibles.
    pub pairs: Vec<LangPair>,
}

impl From<Catalog> for ModelCatalog {
    fn from(catalog: Catalog) -> Self {
        Self {
            ocr_languages: catalog.ocr_languages,
            stt_languages: catalog.stt_languages,
            pairs: catalog
                .pairs
                .into_iter()
                .map(|(from, to)| LangPair { from, to })
                .collect(),
        }
    }
}

fn state_name(state: ModelState) -> &'static str {
    match state {
        ModelState::Missing => "missing",
        ModelState::Downloading => "downloading",
        ModelState::Ready => "ready",
    }
}

pub struct StatusTask {
    pub models: Models,
    pub from: Lang,
    pub to: Lang,
    pub scope: ModelScope,
}

impl Task for StatusTask {
    type Output = Vec<ModelStatus>;
    type JsValue = Vec<ModelStatusInfo>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        self.models
            .status_for(&self.from, &self.to, self.scope)
            .map_err(|e| to_napi(&e))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(|s| ModelStatusInfo {
                id: s.id,
                state: state_name(s.state).to_owned(),
                size: s.size as f64,
            })
            .collect())
    }
}

pub struct DownloadTask {
    pub models: Models,
    pub from: Lang,
    pub to: Lang,
    pub scope: ModelScope,
}

impl Task for DownloadTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<()> {
        self.models
            .download_for(&self.from, &self.to, self.scope)
            .map_err(|e| to_napi(&e))
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> {
        Ok(())
    }
}
