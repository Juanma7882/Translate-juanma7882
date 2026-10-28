//! Estado y descarga de los modelos de una carpeta.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use tr_core::{CoreError, Result};

use crate::download::{fetch, part_path, sha256_file};
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

/// Espacio en disco de un modelo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ModelUsage {
    /// Bytes de los archivos del manifiesto presentes (completos o no).
    pub bytes: u64,
    /// Bytes de descargas a medias (`.part`) que se pueden reanudar.
    pub partial_bytes: u64,
}

impl ModelUsage {
    pub fn total(self) -> u64 {
        self.bytes + self.partial_bytes
    }
}

/// Por qué una carpeta no sirve como carpeta de modelos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirProblem {
    NotAbsolute,
    ParentReferences,
    Root,
    NotAFolder,
    NotWritable,
}

impl DirProblem {
    /// Código estable para que la interfaz elija el mensaje.
    pub fn code(self) -> &'static str {
        match self {
            Self::NotAbsolute => "not-absolute",
            Self::ParentReferences => "parent-references",
            Self::Root => "root",
            Self::NotAFolder => "not-a-folder",
            Self::NotWritable => "not-writable",
        }
    }
}

/// Un identificador o nombre de archivo debe ser un único componente de ruta normal.
fn check_component(name: &str) -> Result<()> {
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(part)), None) if part == name && !name.contains(['/', '\\']) => {
            Ok(())
        }
        _ => Err(CoreError::InvalidArgument(format!(
            "`{name}` is not a valid model name"
        ))),
    }
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

    /// Espacio que ocupa el modelo en disco: archivos del manifiesto y parciales. Solo mira
    /// metadatos (no lee ni verifica el contenido).
    pub fn usage(&self, spec: &ModelSpec) -> ModelUsage {
        let dir = self.model_dir(spec);
        let len = |path: PathBuf| match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_file() => meta.len(),
            _ => 0,
        };
        let mut usage = ModelUsage::default();
        for file in &spec.files {
            usage.bytes += len(dir.join(&file.name));
            usage.partial_bytes += len(part_path(&dir, &file.name));
        }
        usage
    }

    /// Borra un modelo y devuelve los bytes liberados.
    ///
    /// Solo elimina los archivos que el manifiesto asigna al modelo (y sus parciales) dentro de
    /// `<carpeta>/<id>`; la carpeta del modelo se quita únicamente si queda vacía. Rechaza ids que
    /// no sean un único componente de ruta, enlaces simbólicos y modelos que se están descargando.
    pub fn delete(&self, spec: &ModelSpec) -> Result<u64> {
        check_component(&spec.id)?;
        for file in &spec.files {
            check_component(&file.name)?;
        }
        if !lock(&self.downloading).insert(spec.id.clone()) {
            return Err(CoreError::Model(format!(
                "model `{}` is being downloaded; cancel the download first",
                spec.id
            )));
        }
        let _guard = DownloadGuard {
            set: &self.downloading,
            id: spec.id.clone(),
        };

        let dir = self.model_dir(spec);
        match fs::symlink_metadata(&dir) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => {
                return Err(CoreError::Model(format!(
                    "refusing to delete `{}`: it is not a plain folder",
                    spec.id
                )));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => {
                return Err(CoreError::Model(format!(
                    "could not inspect the model: {e}"
                )));
            }
        }
        let inside = fs::canonicalize(&self.dir)
            .and_then(|root| fs::canonicalize(&dir).map(|d| (root, d)))
            .map(|(root, d)| d != root && d.starts_with(&root))
            .unwrap_or(false);
        if !inside {
            return Err(CoreError::Model(format!(
                "refusing to delete `{}`: it is outside the models folder",
                spec.id
            )));
        }

        let mut freed = 0;
        for file in &spec.files {
            for name in [file.name.clone(), format!("{}.part", file.name)] {
                let path = dir.join(&name);
                match fs::symlink_metadata(&path) {
                    Ok(meta) if meta.is_file() => {
                        fs::remove_file(&path).map_err(|e| {
                            CoreError::Model(format!("could not delete `{name}`: {e}"))
                        })?;
                        freed += meta.len();
                    }
                    Ok(_) => {
                        return Err(CoreError::Model(format!(
                            "refusing to delete `{name}`: it is not a plain file"
                        )));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(CoreError::Model(format!("could not inspect `{name}`: {e}")));
                    }
                }
            }
        }
        lock(&self.verified).retain(|path, _| !path.starts_with(&dir));
        // Solo si quedó vacía: archivos ajenos del usuario nunca se tocan.
        let _ = fs::remove_dir(&dir);
        Ok(freed)
    }

    /// Comprueba que `path` sirve como carpeta de modelos: ruta absoluta sin `..`, no la raíz,
    /// carpeta existente (o creable bajo un ancestro que sea carpeta) y con permiso de escritura.
    /// No crea la carpeta; la prueba de escritura (un archivo vacío que se borra al instante) se
    /// hace en la propia carpeta o en su ancestro existente más cercano.
    pub fn validate_dir(path: &Path) -> std::result::Result<(), DirProblem> {
        if !path.is_absolute() {
            return Err(DirProblem::NotAbsolute);
        }
        if path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        {
            return Err(DirProblem::ParentReferences);
        }
        if path.parent().is_none() {
            return Err(DirProblem::Root);
        }
        let mut existing = path;
        while !existing.exists() {
            existing = existing.parent().ok_or(DirProblem::NotWritable)?;
        }
        if !existing.is_dir() {
            return Err(DirProblem::NotAFolder);
        }
        let probe = existing.join(format!(".tr-write-test-{}", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(file) => {
                drop(file);
                let _ = fs::remove_file(&probe);
                Ok(())
            }
            Err(_) => Err(DirProblem::NotWritable),
        }
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
            // El primer aviso de cada archivo se emite siempre: al reanudar trae lo ya descargado.
            let mut first = true;
            fetch(file, &dir, cancel, &mut |n| {
                downloaded += n;
                if first || last.elapsed() >= PROGRESS_EVERY {
                    first = false;
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

    fn ready(tag: &str) -> (Fixture, ModelManager) {
        let fx = fixture(tag);
        let manager = ModelManager::new(&fx.dir);
        manager.ensure(&fx.spec, &never(), &mut |_| {}).unwrap();
        (fx, manager)
    }

    #[test]
    fn usage_counts_final_files_and_partials_without_reading_them() {
        let (fx, manager) = ready("usage");
        let usage = manager.usage(&fx.spec);
        assert_eq!(usage.bytes, fx.spec.total_size());
        assert_eq!(usage.partial_bytes, 0);

        let dir = manager.model_dir(&fx.spec);
        fs::write(dir.join("c.bin.part"), vec![1u8; 77]).unwrap();
        let mut spec = fx.spec.clone();
        spec.files.push(FileSpec {
            name: "c.bin".into(),
            url: "https://x.test/c".into(),
            sha256: "0".repeat(64),
            size: 1000,
        });
        let usage = manager.usage(&spec);
        assert_eq!(usage.partial_bytes, 77);
        assert_eq!(usage.total(), fx.spec.total_size() + 77);
        let absent = ModelSpec {
            id: "nothing".into(),
            ..fx.spec.clone()
        };
        assert_eq!(manager.usage(&absent), ModelUsage::default());
    }

    #[test]
    fn deleting_a_model_removes_only_its_files_and_the_folder_if_empty() {
        let (fx, manager) = ready("delete");
        let other = fx.dir.join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("keep.txt"), b"mine").unwrap();
        let dir = manager.model_dir(&fx.spec);
        fs::write(dir.join("a.bin.part"), b"half").unwrap();

        let freed = manager.delete(&fx.spec).unwrap();
        assert_eq!(freed, fx.spec.total_size() + 4);
        assert!(!dir.exists(), "la carpeta vacía se quita");
        assert_eq!(manager.state(&fx.spec), ModelState::Missing);
        assert_eq!(fs::read(other.join("keep.txt")).unwrap(), b"mine");
        assert_eq!(manager.delete(&fx.spec).unwrap(), 0, "idempotente");
    }

    #[test]
    fn deleting_never_touches_foreign_files_in_the_model_folder() {
        let (fx, manager) = ready("foreign");
        let dir = manager.model_dir(&fx.spec);
        fs::write(dir.join("notes.txt"), b"user file").unwrap();
        manager.delete(&fx.spec).unwrap();
        assert_eq!(fs::read(dir.join("notes.txt")).unwrap(), b"user file");
        assert!(!dir.join("a.bin").exists());
    }

    #[test]
    fn deleting_rejects_ids_that_are_not_a_single_path_component() {
        let (fx, manager) = ready("badid");
        for id in ["../demo", "a/b", "..", ".", "", "a\\b", "/etc"] {
            let spec = ModelSpec {
                id: id.into(),
                ..fx.spec.clone()
            };
            let error = manager.delete(&spec).unwrap_err();
            assert!(
                matches!(error, CoreError::InvalidArgument(_)),
                "{id}: {error}"
            );
        }
        let mut spec = fx.spec.clone();
        spec.files[0].name = "../escape".into();
        assert!(manager.delete(&spec).is_err());
        assert_eq!(manager.state(&fx.spec), ModelState::Ready);
    }

    #[cfg(unix)]
    #[test]
    fn deleting_refuses_symbolic_links() {
        let (fx, manager) = ready("symlink");
        let outside = scratch("symlink-outside");
        fs::write(outside.join("a.bin"), b"precious").unwrap();
        let linked = ModelSpec {
            id: "linked".into(),
            ..fx.spec.clone()
        };
        std::os::unix::fs::symlink(&outside, manager.model_dir(&linked)).unwrap();
        let error = manager.delete(&linked).unwrap_err();
        assert!(error.to_string().contains("refusing"), "{error}");
        assert_eq!(fs::read(outside.join("a.bin")).unwrap(), b"precious");

        // Un archivo que es enlace tampoco se sigue.
        let dir = manager.model_dir(&fx.spec);
        fs::remove_file(dir.join("b.txt")).unwrap();
        std::os::unix::fs::symlink(outside.join("a.bin"), dir.join("b.txt")).unwrap();
        assert!(manager.delete(&fx.spec).is_err());
        assert_eq!(fs::read(outside.join("a.bin")).unwrap(), b"precious");
    }

    #[test]
    fn deleting_is_refused_while_the_model_downloads() {
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
        let manager = std::sync::Arc::new(ModelManager::new(scratch("delete-busy")));
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let worker = {
            let (manager, spec, cancel) = (manager.clone(), spec.clone(), cancel.clone());
            std::thread::spawn(move || manager.ensure(&spec, &cancel, &mut |_| {}))
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        while manager.state(&spec) != ModelState::Downloading {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let error = manager.delete(&spec).unwrap_err();
        assert!(error.to_string().contains("being downloaded"), "{error}");
        while manager.usage(&spec).partial_bytes == 0 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        cancel.store(true, Ordering::Release);
        assert!(worker.join().unwrap().is_err());
        // Cancelada: queda un parcial que el borrado sí limpia.
        assert!(manager.usage(&spec).partial_bytes > 0);
        manager.delete(&spec).unwrap();
        assert_eq!(manager.usage(&spec), ModelUsage::default());
    }

    #[test]
    fn a_cancelled_model_download_resumes_and_progress_includes_the_partial() {
        let body: Vec<u8> = (0..150_000u32).map(|i| (i % 249) as u8).collect();
        let server = TestServer::start(vec![(
            "/r",
            Route::Resumable {
                body: body.clone(),
                chunk: 10_000,
                delay: Duration::ZERO,
                cut_first_at: Some(70_000),
            },
        )]);
        let spec = ModelSpec {
            id: "resume".into(),
            files: vec![FileSpec {
                url: server.url("/r"),
                ..file(&server, "r.bin", &body)
            }],
        };
        let manager = ModelManager::new(scratch("model-resume"));
        manager.ensure(&spec, &never(), &mut |_| {}).unwrap_err();
        assert_eq!(manager.state(&spec), ModelState::Missing);
        assert_eq!(manager.usage(&spec).partial_bytes, 70_000);

        let mut events = Vec::new();
        manager
            .ensure(&spec, &never(), &mut |p| events.push(p.downloaded))
            .unwrap();
        assert_eq!(manager.state(&spec), ModelState::Ready);
        assert_eq!(manager.usage(&spec).partial_bytes, 0);
        assert!(events.windows(2).all(|w| w[0] <= w[1]), "{events:?}");
        assert_eq!(*events.last().unwrap(), body.len() as u64);
        assert!(events[0] <= 70_000 + 1);
    }

    #[test]
    fn folder_validation_accepts_writable_and_creatable_folders() {
        let root = scratch("validate");
        assert_eq!(ModelManager::validate_dir(&root), Ok(()));
        assert_eq!(
            ModelManager::validate_dir(&root.join("not/yet/created")),
            Ok(())
        );
        assert!(!root.join("not").exists(), "validar no crea carpetas");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0, "ni deja pruebas");
    }

    #[test]
    fn folder_validation_explains_why_a_path_is_not_valid() {
        let root = scratch("invalid");
        let file = root.join("a-file");
        fs::write(&file, b"x").unwrap();
        let cases = [
            (PathBuf::from("relative/dir"), DirProblem::NotAbsolute),
            (root.join("..").join("x"), DirProblem::ParentReferences),
            (file.clone(), DirProblem::NotAFolder),
            (file.join("below"), DirProblem::NotAFolder),
        ];
        for (path, problem) in cases {
            assert_eq!(
                ModelManager::validate_dir(&path),
                Err(problem),
                "{}",
                path.display()
            );
        }
        let top = if cfg!(windows) { "C:\\" } else { "/" };
        assert_eq!(
            ModelManager::validate_dir(Path::new(top)),
            Err(DirProblem::Root)
        );
        assert_eq!(DirProblem::NotWritable.code(), "not-writable");
    }

    #[cfg(unix)]
    #[test]
    fn folder_validation_rejects_read_only_folders() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("readonly");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
        let result = ModelManager::validate_dir(&root.join("sub"));
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        // Como root el sistema permite escribir igualmente: solo se exige cuando no lo es.
        let is_root = std::fs::metadata("/proc/self").is_ok_and(|m| {
            use std::os::unix::fs::MetadataExt;
            m.uid() == 0
        });
        if !is_root {
            assert_eq!(result, Err(DirProblem::NotWritable));
        }
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
