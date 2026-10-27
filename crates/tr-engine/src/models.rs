//! Servicio de modelos: estado y descarga por par de idiomas, con progreso como eventos.
//!
//! Es independiente del [`Engine`](crate::Engine): una descarga larga no bloquea el arranque ni
//! la parada de la traducción.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tr_core::{CoreError, Event, EventSink, Lang, Result};
use tr_models::{Manifest, ModelManager, ModelState};

/// Estado de un modelo necesario para un par de idiomas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelStatus {
    pub id: String,
    pub state: ModelState,
    /// Tamaño total de sus archivos, en bytes.
    pub size: u64,
}

struct Inner {
    manager: ModelManager,
    manifest: Arc<Manifest>,
    sink: Arc<dyn EventSink>,
    cancel: AtomicBool,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

/// Idiomas y pares para los que hay modelos, según el manifiesto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Catalog {
    /// Idiomas que el OCR sabe reconocer.
    pub ocr_languages: Vec<String>,
    /// Idiomas que el reconocimiento de voz sabe transcribir.
    pub stt_languages: Vec<String>,
    /// Pares de traducción (`origen`, `destino`).
    pub pairs: Vec<(String, String)>,
}

/// Qué modelos de un par se consultan o descargan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ModelScope {
    /// OCR y traducción (traducir texto en pantalla).
    #[default]
    Text,
    /// Reconocimiento de voz y traducción (subtítulos del audio).
    Audio,
    /// Todo lo anterior, sin repetidos.
    All,
}

impl std::str::FromStr for ModelScope {
    type Err = CoreError;

    fn from_str(name: &str) -> Result<Self> {
        match name {
            "text" => Ok(Self::Text),
            "audio" => Ok(Self::Audio),
            "all" => Ok(Self::All),
            other => Err(CoreError::InvalidArgument(format!(
                "unknown model scope `{other}` (use `text`, `audio` or `all`)"
            ))),
        }
    }
}

/// Se clona barato: todos los clones comparten la misma carpeta y la misma señal de cancelación.
#[derive(Clone)]
pub struct Models {
    inner: Arc<Inner>,
}

/// Carpeta de modelos: la configurada o la del usuario según el sistema.
pub(crate) fn resolve_dir(configured: Option<PathBuf>) -> Result<PathBuf> {
    configured
        .or_else(ModelManager::default_dir)
        .ok_or_else(|| {
            CoreError::Model(
                "no models folder is configured and this system has no user data folder".into(),
            )
        })
}

impl Models {
    /// Con el manifiesto incluido en el binario.
    pub fn new(models_dir: Option<PathBuf>, sink: Arc<dyn EventSink>) -> Result<Self> {
        Self::with_manifest(models_dir, Arc::new(Manifest::embedded().clone()), sink)
    }

    /// Con un manifiesto propio (pruebas con un servidor local).
    pub fn with_manifest(
        models_dir: Option<PathBuf>,
        manifest: Arc<Manifest>,
        sink: Arc<dyn EventSink>,
    ) -> Result<Self> {
        let manager = ModelManager::new(resolve_dir(models_dir)?);
        Ok(Self {
            inner: Arc::new(Inner {
                manager,
                manifest,
                sink,
                cancel: AtomicBool::new(false),
            }),
        })
    }

    pub fn dir(&self) -> &std::path::Path {
        self.inner.manager.dir()
    }

    /// Idiomas y pares disponibles (lo que la interfaz puede ofrecer al usuario).
    pub fn catalog(&self) -> Catalog {
        let manifest = &self.inner.manifest;
        Catalog {
            ocr_languages: manifest
                .ocr_languages()
                .into_iter()
                .map(str::to_owned)
                .collect(),
            stt_languages: manifest
                .stt_languages()
                .into_iter()
                .map(str::to_owned)
                .collect(),
            pairs: manifest
                .translation_pairs()
                .into_iter()
                .map(|(from, to)| (from.to_owned(), to.to_owned()))
                .collect(),
        }
    }

    /// Estado de los modelos que hacen falta para reconocer `from` y traducir `from` -> `to`.
    pub fn status(&self, from: &Lang, to: &Lang) -> Result<Vec<ModelStatus>> {
        self.status_for(from, to, ModelScope::Text)
    }

    fn specs(
        &self,
        from: &Lang,
        to: &Lang,
        scope: ModelScope,
    ) -> Result<Vec<&tr_models::ModelSpec>> {
        let manifest = &self.inner.manifest;
        match scope {
            ModelScope::Text => manifest.required_for(from, to),
            ModelScope::Audio => manifest.required_for_audio(from, to),
            ModelScope::All => manifest.required_for_all(from, to),
        }
    }

    /// Estado de los modelos del par según `scope`.
    pub fn status_for(
        &self,
        from: &Lang,
        to: &Lang,
        scope: ModelScope,
    ) -> Result<Vec<ModelStatus>> {
        let specs = self.specs(from, to, scope)?;
        Ok(specs
            .into_iter()
            .map(|spec| ModelStatus {
                id: spec.id.clone(),
                state: self.inner.manager.state(spec),
                size: spec.total_size(),
            })
            .collect())
    }

    /// Descarga lo que falte para el par (bloquea hasta terminar) y emite `Event::ModelProgress`.
    /// Con todo listo no toca la red.
    pub fn download(&self, from: &Lang, to: &Lang) -> Result<()> {
        self.download_for(from, to, ModelScope::Text)
    }

    /// Como [`download`](Self::download), para los modelos de `scope`.
    pub fn download_for(&self, from: &Lang, to: &Lang, scope: ModelScope) -> Result<()> {
        let inner = &self.inner;
        let specs = self.specs(from, to, scope)?;
        inner.cancel.store(false, Ordering::Release);
        for spec in specs {
            inner.manager.ensure(spec, &inner.cancel, &mut |progress| {
                inner.sink.emit(Event::ModelProgress {
                    model: progress.model,
                    downloaded: progress.downloaded,
                    total: Some(progress.total),
                });
            })?;
        }
        Ok(())
    }

    /// Interrumpe la descarga en curso, si la hay.
    pub fn cancel(&self) {
        self.inner.cancel.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_parse_by_name_and_default_to_text() {
        assert_eq!("text".parse::<ModelScope>().unwrap(), ModelScope::Text);
        assert_eq!("audio".parse::<ModelScope>().unwrap(), ModelScope::Audio);
        assert_eq!("all".parse::<ModelScope>().unwrap(), ModelScope::All);
        assert_eq!(ModelScope::default(), ModelScope::Text);
        assert!(matches!(
            "video".parse::<ModelScope>(),
            Err(CoreError::InvalidArgument(_))
        ));
    }
}
