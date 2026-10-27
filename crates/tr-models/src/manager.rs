//! Estado y descarga de los modelos de una carpeta.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use tr_core::{CoreError, Result};

use crate::download::{fetch, sha256_file};
use crate::manifest::{FileSpec, ModelSpec};

/// No se emite progreso más seguido que esto (salvo el final).
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelState {
    /// Falta algún archivo o alguno no coincide con su huella.
    Missing,
    Downloading,
    /// Todos los archivos existen y coinciden con el manifiesto.
    Ready,
}

/// Avance de la descarga de un modelo completo (suma de sus archivos).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelProgress {
    pub model: String,
    pub downloaded: u64,
    pub total: u64,
}

/// Última verificación correcta de un archivo: tamaño y fecha de modificación.
type Stamp = (u64, Option<SystemTime>);

pub struct ModelManager {
    dir: PathBuf,
    verified: Mutex<HashMap<PathBuf, Stamp>>,
    downloading: Mutex<HashSet<String>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Quita al modelo del conjunto "descargando" al salir, también si hay un error.
struct DownloadGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    id: String,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        lock(self.set).remove(&self.id);
    }
}

impl ModelManager {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            verified: Mutex::default(),
            downloading: Mutex::default(),
        }
    }

    /// Carpeta de datos del usuario según el sistema (`.../translate/models`).
    pub fn default_dir() -> Option<PathBuf> {
        let base = if cfg!(target_os = "windows") {
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        } else if cfg!(target_os = "macos") {
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
        } else {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        }?;
        Some(base.join("translate").join("models"))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn model_dir(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(&spec.id)
    }

    pub fn file_path(&self, spec: &ModelSpec, name: &str) -> PathBuf {
        self.model_dir(spec).join(name)
    }

    pub fn state(&self, spec: &ModelSpec) -> ModelState {
        if lock(&self.downloading).contains(&spec.id) {
            ModelState::Downloading
        } else if spec.files.iter().all(|f| self.file_is_valid(spec, f)) {
            ModelState::Ready
        } else {
            ModelState::Missing
        }
    }

    /// Identificadores de los modelos que todavía no están listos.
    pub fn missing(&self, specs: &[&ModelSpec]) -> Vec<String> {
        specs
            .iter()
            .filter(|s| self.state(s) != ModelState::Ready)
            .map(|s| s.id.clone())
            .collect()
    }

    /// Un archivo es válido si existe con el tamaño del manifiesto y su SHA-256 coincide. El
    /// resultado se recuerda (en memoria) mientras no cambien tamaño ni fecha, para no volver a
    /// leer cientos de MB en cada consulta.
    fn file_is_valid(&self, spec: &ModelSpec, file: &FileSpec) -> bool {
        let path = self.file_path(spec, &file.name);
        let Ok(meta) = fs::metadata(&path) else {
            return false;
        };
        if !meta.is_file() || meta.len() != file.size {
            return false;
        }
        let stamp = (meta.len(), meta.modified().ok());
        if lock(&self.verified).get(&path) == Some(&stamp) {
            return true;
        }
        match sha256_file(&path) {
            Ok(digest) if digest == file.sha256 => {
                lock(&self.verified).insert(path, stamp);
                true
            }
            _ => false,
        }
    }

    /// Deja el modelo listo, descargando solo lo que falta o está corrupto. Si ya está listo no
    /// toca la red. `progress` recibe el avance total del modelo; `cancel` lo interrumpe.
    pub fn ensure(
        &self,
        spec: &ModelSpec,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(ModelProgress),
    ) -> Result<()> {
        let pending: Vec<&FileSpec> = spec
            .files
            .iter()
            .filter(|f| !self.file_is_valid(spec, f))
            .collect();
        if pending.is_empty() {
            return Ok(());
        }
        if !lock(&self.downloading).insert(spec.id.clone()) {
            return Err(CoreError::Model(format!(
                "model `{}` is already being downloaded",
                spec.id
            )));
        }
        let _guard = DownloadGuard {
            set: &self.downloading,
            id: spec.id.clone(),
        };

        let dir = self.model_dir(spec);
        fs::create_dir_all(&dir)
            .map_err(|e| CoreError::Model(format!("could not create the models folder: {e}")))?;

        let total = spec.total_size();
        let mut downloaded = total - pending.iter().map(|f| f.size).sum::<u64>();
        let report = |downloaded: u64, progress: &mut dyn FnMut(ModelProgress)| {
            progress(ModelProgress {
                model: spec.id.clone(),
                downloaded,
                total,
            });
        };
        report(downloaded, progress);
        let mut last = Instant::now();

        for file in pending {
            fetch(file, &dir, cancel, &mut |n| {
                downloaded += n;
                if last.elapsed() >= PROGRESS_EVERY {
                    last = Instant::now();
                    report(downloaded, progress);
                }
            })?;
            report(downloaded, progress);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use super::*;
    use crate::download::sha256_hex;
    use crate::testing::{Route, TestServer};

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tr-manager-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(server: &TestServer, name: &str, body: &[u8]) -> FileSpec {
        FileSpec {
            name: name.into(),
            url: server.url(&format!("/{name}")),
            sha256: sha256_hex(body),
            size: body.len() as u64,
        }
    }

    struct Fixture {
        server: TestServer,
        spec: ModelSpec,
        bodies: Vec<(String, Vec<u8>)>,
        dir: PathBuf,
    }

    fn fixture(tag: &str) -> Fixture {
        let bodies: Vec<(String, Vec<u8>)> = vec![
            (
                "a.bin".into(),
                (0..120_000u32).map(|i| (i % 253) as u8).collect(),
            ),
            ("b.txt".into(), b"hello model".to_vec()),
        ];
        let routes = bodies
            .iter()
            .map(|(n, b)| (format!("/{n}"), Route::Body(b.clone())))
            .collect::<Vec<_>>();
        let server = TestServer::start(
            routes
                .iter()
                .map(|(p, r)| (p.as_str(), r.clone()))
                .collect(),
        );
        let spec = ModelSpec {
            id: "demo".into(),
            files: bodies.iter().map(|(n, b)| file(&server, n, b)).collect(),
        };
        Fixture {
            server,
            spec,
            bodies,
            dir: scratch(tag),
        }
    }

    fn never() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn a_missing_model_is_downloaded_with_growing_progress_and_becomes_ready() {
        let fx = fixture("download");
        let manager = ModelManager::new(&fx.dir);
        assert_eq!(manager.state(&fx.spec), ModelState::Missing);
        assert_eq!(manager.missing(&[&fx.spec]), ["demo"]);

        let mut events = Vec::new();
        manager
            .ensure(&fx.spec, &never(), &mut |p| events.push(p))
            .unwrap();

        assert_eq!(manager.state(&fx.spec), ModelState::Ready);
        assert!(manager.missing(&[&fx.spec]).is_empty());
        let total = fx.spec.total_size();
        assert!(events.iter().all(|p| p.model == "demo" && p.total == total));
        assert!(
            events
                .windows(2)
                .all(|w| w[0].downloaded <= w[1].downloaded),
            "no retrocede"
        );
        assert_eq!(events.first().unwrap().downloaded, 0);
        assert_eq!(events.last().unwrap().downloaded, total);
        for (name, body) in &fx.bodies {
            assert_eq!(fs::read(manager.file_path(&fx.spec, name)).unwrap(), *body);
        }
    }

    #[test]
    fn a_ready_model_is_not_downloaded_again() {
        let fx = fixture("idempotent");
        let manager = ModelManager::new(&fx.dir);
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        let hits = fx.server.total_hits();

        let mut events = 0;
        manager
            .ensure(&fx.spec, &never(), &mut |_| events += 1)
            .unwrap();
        assert_eq!(fx.server.total_hits(), hits, "sin nuevas peticiones");
        assert_eq!(events, 0, "ni progreso");
    }

    #[test]
    fn ready_models_work_without_network() {
        let fx = fixture("offline");
        ModelManager::new(&fx.dir)
            .ensure(&fx.spec, &never(), &mut |_| {})
            .unwrap();
        drop(fx.server); // se acabó la red

        let manager = ModelManager::new(&fx.dir); // proceso nuevo: vuelve a verificar
        assert_eq!(manager.state(&fx.spec), ModelState::Ready);
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
    }

    #[test]
    fn a_corrupt_file_makes_the_model_missing_and_only_that_file_is_downloaded_again() {
        let fx = fixture("corrupt");
        let manager = ModelManager::new(&fx.dir);
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        let (hits_a, hits_b) = (fx.server.hits("/a.bin"), fx.server.hits("/b.txt"));

        let path = manager.file_path(&fx.spec, "b.txt");
        fs::write(&path, b"hello MODEL").unwrap(); // mismo tamaño, contenido distinto
        assert_eq!(manager.state(&fx.spec), ModelState::Missing);

        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        assert_eq!(manager.state(&fx.spec), ModelState::Ready);
        assert_eq!(fs::read(&path).unwrap(), b"hello model");
        assert_eq!(
            fx.server.hits("/a.bin"),
            hits_a,
            "el archivo sano no se repite"
        );
        assert_eq!(fx.server.hits("/b.txt"), hits_b + 1);
    }

    #[test]
    fn a_truncated_file_is_not_ready() {
        let fx = fixture("truncated");
        let manager = ModelManager::new(&fx.dir);
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        let path = manager.file_path(&fx.spec, "a.bin");
        let data = fs::read(&path).unwrap();
        fs::write(&path, &data[..1000]).unwrap();
        assert_eq!(manager.state(&fx.spec), ModelState::Missing);
    }

    #[test]
    fn a_failed_download_leaves_the_model_missing_and_reports_the_error() {
        let fx = fixture("fail");
        let mut spec = fx.spec.clone();
        spec.files[1].url = fx.server.url("/does-not-exist");
        let manager = ModelManager::new(&fx.dir);
        let error = manager.ensure(&spec, &never(), &mut |_| {}).unwrap_err();
        assert!(matches!(error, CoreError::Model(_)), "{error}");
        assert_eq!(manager.state(&spec), ModelState::Missing);
        // Reintentar con la URL buena funciona.
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        assert_eq!(manager.state(&fx.spec), ModelState::Ready);
    }

    #[test]
    fn downloads_only_touch_the_models_folder() {
        let fx = fixture("scope");
        let root = fx.dir.clone();
        ModelManager::new(root.join("models"))
            .ensure(&fx.spec, &never(), &mut |_| {})
            .unwrap();
        let top: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(top, ["models"]);
        let inner: Vec<_> = fs::read_dir(root.join("models"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(inner, ["demo"]);
    }

    #[test]
    fn the_state_is_downloading_while_a_download_runs_and_a_second_one_is_refused() {
        let body: Vec<u8> = vec![7; 100_000];
        let server = TestServer::start(vec![(
            "/slow",
            Route::Slow {
                body: body.clone(),
                chunk: 10_000,
                delay: Duration::from_millis(40),
            },
        )]);
        let spec = ModelSpec {
            id: "slow".into(),
            files: vec![file(&server, "slow", &body)],
        };
        let spec = ModelSpec {
            files: vec![FileSpec {
                url: server.url("/slow"),
                ..spec.files[0].clone()
            }],
            ..spec
        };
        let manager = std::sync::Arc::new(ModelManager::new(scratch("busy")));
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let worker = {
            let (manager, spec, cancel) = (manager.clone(), spec.clone(), cancel.clone());
            std::thread::spawn(move || manager.ensure(&spec, &cancel, &mut |_| {}))
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        while manager.state(&spec) != ModelState::Downloading {
            assert!(Instant::now() < deadline, "debería pasar a Downloading");
            std::thread::sleep(Duration::from_millis(5));
        }
        let error = manager.ensure(&spec, &never(), &mut |_| {}).unwrap_err();
        assert!(
            error.to_string().contains("already being downloaded"),
            "{error}"
        );

        cancel.store(true, Ordering::Release);
        assert!(worker.join().unwrap().is_err());
        assert_eq!(
            manager.state(&spec),
            ModelState::Missing,
            "tras cancelar no queda descargando"
        );
    }

    /// Contra internet de verdad: valida TLS (rustls), la redirección de GitHub y la huella del
    /// manifiesto con el archivo más pequeño. `cargo test -p tr-models -- --ignored`.
    #[test]
    #[ignore = "necesita acceso a internet"]
    fn the_smallest_embedded_model_file_downloads_from_the_internet() {
        let manifest = crate::Manifest::embedded();
        let model = manifest.model("ocr-ppocrv6-small").unwrap();
        let dict = model.files.iter().min_by_key(|f| f.size).unwrap().clone();
        let spec = ModelSpec {
            id: "internet".into(),
            files: vec![dict.clone()],
        };
        let manager = ModelManager::new(scratch("internet"));
        let mut last = 0;
        manager
            .ensure(&spec, &never(), &mut |p| last = p.downloaded)
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(manager.state(&spec), ModelState::Ready);
        assert_eq!(last, dict.size);
    }

    #[test]
    fn the_default_folder_is_inside_the_user_data_dir() {
        let dir = ModelManager::default_dir().expect("el sistema tiene carpeta de datos");
        assert!(
            dir.ends_with("translate/models") || dir.ends_with("translate\\models"),
            "{}",
            dir.display()
        );
    }
}
