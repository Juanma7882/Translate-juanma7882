//! Estado y descarga de modelos expuestos a JS como tareas asíncronas (promesas).
//!
//! Se ejecutan en el pool de hilos de libuv, así que el hilo de JS nunca espera a la red ni al
//! cálculo de huellas.

use napi::{Env, Task};
use napi_derive::napi;
use tr_engine::tr_core::Lang;
use tr_engine::{Catalog, Inventory, ModelScope, ModelState, ModelStatus, Models};

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
    pub to: Vec<Lang>,
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
    pub to: Vec<Lang>,
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

#[napi(object)]
pub struct ModelRoleInfo {
    /// `ocr`, `stt` o `translate`.
    pub kind: String,
    /// Idioma (`en`) o par (`en-es`).
    pub key: String,
}

/// Un modelo del manifiesto con su estado y el espacio que ocupa.
#[napi(object)]
pub struct InstalledModelInfo {
    pub id: String,
    pub roles: Vec<ModelRoleInfo>,
    /// `missing`, `downloading` o `ready`.
    pub state: String,
    /// Tamaño completo según el manifiesto, en bytes.
    pub size: f64,
    /// Bytes presentes en disco.
    pub disk_bytes: f64,
    /// Bytes de una descarga a medias que se puede reanudar.
    pub partial_bytes: f64,
}

#[napi(object)]
pub struct ModelInventory {
    /// Carpeta de modelos en uso.
    pub dir: String,
    pub models: Vec<InstalledModelInfo>,
    /// Espacio total ocupado en disco, en bytes.
    pub total_bytes: f64,
}

impl From<Inventory> for ModelInventory {
    fn from(inventory: Inventory) -> Self {
        Self {
            dir: inventory.dir.to_string_lossy().into_owned(),
            total_bytes: inventory.total_bytes as f64,
            models: inventory
                .models
                .into_iter()
                .map(|m| InstalledModelInfo {
                    id: m.id,
                    roles: m
                        .roles
                        .into_iter()
                        .map(|r| ModelRoleInfo {
                            kind: r.kind.to_owned(),
                            key: r.key,
                        })
                        .collect(),
                    state: state_name(m.state).to_owned(),
                    size: m.size as f64,
                    disk_bytes: m.disk_bytes as f64,
                    partial_bytes: m.partial_bytes as f64,
                })
                .collect(),
        }
    }
}

pub struct InventoryTask {
    pub models: Models,
}

impl Task for InventoryTask {
    type Output = Inventory;
    type JsValue = ModelInventory;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(self.models.inventory())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct DeleteTask {
    pub models: Models,
    pub id: String,
}

impl Task for DeleteTask {
    type Output = u64;
    type JsValue = f64;

    fn compute(&mut self) -> napi::Result<u64> {
        self.models.delete(&self.id).map_err(|e| to_napi(&e))
    }

    fn resolve(&mut self, _env: Env, freed: u64) -> napi::Result<f64> {
        Ok(freed as f64)
    }
}

/// Resultado de validar una carpeta de modelos candidata.
#[napi(object)]
pub struct ModelsDirCheck {
    pub ok: bool,
    /// Si no es válida: `not-absolute`, `parent-references`, `root`, `not-a-folder` o `not-writable`.
    pub reason: Option<String>,
}
