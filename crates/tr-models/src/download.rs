//! Descarga de un archivo: `.part` reanudable (`Range`) + SHA-256 en streaming + `rename` atómico.
//!
//! El parcial `<nombre>.part` se conserva cuando la descarga se cancela o la red falla, para poder
//! reanudarla; se descarta si el contenido no coincide con el manifiesto (tamaño o huella) o si el
//! servidor rechaza el rango. Un parcial nunca se considera un modelo válido.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tr_core::{CoreError, Result};

use crate::manifest::FileSpec;

const CHUNK: usize = 64 * 1024;

fn error(message: impl Into<String>) -> CoreError {
    CoreError::Model(message.into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256 en hexadecimal minúscula.
pub fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

/// SHA-256 de un archivo, leído por trozos.
pub(crate) fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            return Ok(hex(&hasher.finalize()));
        }
        hasher.update(&buffer[..n]);
    }
}

/// Ruta del parcial de un archivo del manifiesto.
pub(crate) fn part_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.part"))
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        // Los 4xx/5xx llegan como respuesta: el 416 de un rango inválido se trata aparte.
        .http_status_as_error(false)
        .build()
        .into()
}

/// Fallo de una descarga y si el parcial sigue siendo útil para reanudar.
struct Failure {
    error: CoreError,
    keep_part: bool,
}

/// El parcial se conserva: nada del contenido es sospechoso (cancelación, red, estado HTTP).
fn resumable(message: impl Into<String>) -> Failure {
    Failure {
        error: error(message),
        keep_part: true,
    }
}

/// El parcial se descarta: su contenido o el entorno no permiten confiar en él.
fn fatal(message: impl Into<String>) -> Failure {
    Failure {
        error: error(message),
        keep_part: false,
    }
}

/// Descarga `spec` en `dir/<name>`. Solo deja el archivo final si su tamaño y su huella
/// coinciden con el manifiesto. Un parcial previo se reanuda con `Range` si el servidor lo admite.
/// `on_bytes` recibe el tamaño de cada trozo recibido (y, al reanudar, los bytes ya existentes).
pub(crate) fn fetch(
    spec: &FileSpec,
    dir: &Path,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<()> {
    let part = part_path(dir, &spec.name);
    match download_to(spec, dir, &part, cancel, on_bytes, true) {
        Ok(()) => Ok(()),
        Err(failure) => {
            if !failure.keep_part {
                let _ = fs::remove_file(&part);
            }
            Err(failure.error)
        }
    }
}

/// Bytes de un parcial reutilizable (0 si no hay o es inservible).
fn usable_part_len(part: &Path, size: u64) -> u64 {
    match fs::metadata(part) {
        Ok(meta) if meta.is_file() && meta.len() < size => meta.len(),
        Ok(_) => {
            let _ = fs::remove_file(part);
            0
        }
        Err(_) => 0,
    }
}

/// `Content-Range: bytes START-END/TOTAL` -> `(START, TOTAL)`.
fn content_range(value: &str) -> Option<(u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, _end) = range.split_once('-')?;
    Some((start.parse().ok()?, total.parse().ok()))
}

fn download_to(
    spec: &FileSpec,
    dir: &Path,
    part: &Path,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
    may_retry: bool,
) -> std::result::Result<(), Failure> {
    let name = &spec.name;
    let existing = usable_part_len(part, spec.size);
    let mut request = agent().get(&spec.url);
    if existing > 0 {
        request = request.header("Range", format!("bytes={existing}-"));
    }
    let response = request
        .call()
        .map_err(|e| resumable(format!("could not download `{name}`: {e}")))?;
    let status = response.status().as_u16();

    if status == 416 && existing > 0 && may_retry {
        // El servidor no acepta el rango (el parcial no le sirve): desde cero.
        let _ = fs::remove_file(part);
        return download_to(spec, dir, part, cancel, on_bytes, false);
    }
    if !(200..300).contains(&status) {
        return Err(resumable(format!(
            "could not download `{name}`: server answered {status}"
        )));
    }

    // Con 206 solo se continúa si el rango empieza justo donde quedó el parcial.
    let resuming = if existing > 0 && status == 206 {
        let range = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(content_range);
        match range {
            Some((start, total)) if start == existing && total.is_none_or(|t| t == spec.size) => {
                true
            }
            _ => return Err(fatal(format!("`{name}` got an unexpected byte range"))),
        }
    } else if status == 206 {
        return Err(fatal(format!(
            "`{name}` got a partial answer to a full request"
        )));
    } else {
        false
    };

    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut file = if resuming {
        let mut old = fs::File::open(part)
            .map_err(|e| fatal(format!("could not read the partial `{name}`: {e}")))?;
        let mut buffer = vec![0u8; CHUNK];
        loop {
            let n = old
                .read(&mut buffer)
                .map_err(|e| fatal(format!("could not read the partial `{name}`: {e}")))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        received = existing;
        on_bytes(existing);
        fs::OpenOptions::new()
            .append(true)
            .open(part)
            .map_err(|e| fatal(format!("could not write `{name}`: {e}")))?
    } else {
        fs::File::create(part).map_err(|e| fatal(format!("could not write `{name}`: {e}")))?
    };

    let mut reader = response.into_body().into_reader();
    let mut buffer = vec![0u8; CHUNK];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(resumable("download cancelled"));
        }
        let n = reader
            .read(&mut buffer)
            .map_err(|e| resumable(format!("network error while downloading `{name}`: {e}")))?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > spec.size {
            return Err(fatal(format!(
                "`{name}` is larger than expected ({} bytes)",
                spec.size
            )));
        }
        file.write_all(&buffer[..n])
            .map_err(|e| fatal(format!("could not write `{name}`: {e}")))?;
        hasher.update(&buffer[..n]);
        on_bytes(n as u64);
    }
    file.flush()
        .map_err(|e| fatal(format!("could not write `{name}`: {e}")))?;
    drop(file);

    if received != spec.size {
        // Cortada antes de tiempo: lo recibido sigue siendo válido para reanudar.
        return Err(resumable(format!(
            "`{name}` is incomplete: expected {} bytes, received {received}",
            spec.size
        )));
    }
    if hex(&hasher.finalize()) != spec.sha256 {
        return Err(fatal(format!(
            "`{name}` is corrupt: its SHA-256 does not match the manifest"
        )));
    }
    fs::rename(part, dir.join(name)).map_err(|e| fatal(format!("could not finish `{name}`: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Route, TestServer};

    fn spec_for(server: &TestServer, path: &str, body: &[u8]) -> FileSpec {
        FileSpec {
            name: "model.bin".into(),
            url: server.url(path),
            sha256: sha256_hex(body),
            size: body.len() as u64,
        }
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tr-models-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn payload() -> Vec<u8> {
        (0..200_000u32).map(|i| (i % 251) as u8).collect()
    }

    fn resumable_route(body: &[u8], cut_first_at: Option<usize>) -> Route {
        Route::Resumable {
            body: body.to_vec(),
            chunk: 10_000,
            delay: Duration::ZERO,
            cut_first_at,
        }
    }

    #[test]
    fn sha256_matches_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_good_download_is_verified_and_reports_growing_progress() {
        let body = payload();
        let server = TestServer::start(vec![("/m", Route::Body(body.clone()))]);
        let dir = scratch("ok");
        let mut seen = Vec::new();
        fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |n| seen.push(n),
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
        assert_eq!(seen.iter().sum::<u64>(), body.len() as u64);
        assert!(seen.len() > 1, "llega en varios trozos");
        assert_eq!(entries(&dir), ["model.bin"], "sin archivos parciales");
    }

    #[test]
    fn a_redirect_is_followed() {
        let body = payload();
        let server = TestServer::start(vec![
            ("/r", Route::Redirect("/m".into())),
            ("/m", Route::Body(body.clone())),
        ]);
        let dir = scratch("redirect");
        let spec = spec_for(&server, "/r", &body);
        fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
    }

    #[test]
    fn a_wrong_checksum_is_discarded_with_its_partial() {
        let body = payload();
        let mut tampered = body.clone();
        tampered[10] ^= 0xff;
        let server = TestServer::start(vec![("/m", Route::Body(tampered))]);
        let dir = scratch("checksum");
        let error = fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap_err();
        assert!(error.to_string().contains("corrupt"), "{error}");
        assert!(
            entries(&dir).is_empty(),
            "no queda ni el final ni el parcial"
        );
    }

    #[test]
    fn http_errors_are_reported_without_leaving_files() {
        let server = TestServer::start(vec![("/boom", Route::Status(500))]);
        let dir = scratch("http");
        for path in ["/boom", "/missing"] {
            let spec = FileSpec {
                name: "model.bin".into(),
                url: server.url(path),
                sha256: "0".repeat(64),
                size: 10,
            };
            let error = fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
            assert!(matches!(error, CoreError::Model(_)), "{error}");
        }
        assert!(entries(&dir).is_empty());
    }

    #[test]
    fn a_cut_connection_leaves_no_final_file_but_keeps_the_partial() {
        let body = payload();
        let server = TestServer::start(vec![(
            "/m",
            Route::Truncated {
                declared: body.len(),
                sent: body[..50_000].to_vec(),
            },
        )]);
        let dir = scratch("cut");
        let error = fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap_err();
        assert!(matches!(error, CoreError::Model(_)), "{error}");
        assert_eq!(entries(&dir), ["model.bin.part"]);
        assert_eq!(
            fs::metadata(dir.join("model.bin.part")).unwrap().len(),
            50_000
        );
    }

    #[test]
    fn a_body_larger_than_the_manifest_is_rejected() {
        let body = payload();
        let server = TestServer::start(vec![("/m", Route::Body(body.clone()))]);
        let dir = scratch("big");
        let mut spec = spec_for(&server, "/m", &body);
        spec.size = 1000;
        let error = fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(
            error.to_string().contains("larger than expected"),
            "{error}"
        );
        assert!(entries(&dir).is_empty());
    }

    #[test]
    fn cancelling_stops_the_download_and_keeps_the_partial() {
        let body = payload();
        let server = TestServer::start(vec![(
            "/m",
            Route::Slow {
                body: body.clone(),
                chunk: 10_000,
                delay: Duration::from_millis(20),
            },
        )]);
        let dir = scratch("cancel");
        let cancel = AtomicBool::new(false);
        let mut chunks = 0;
        let error = fetch(&spec_for(&server, "/m", &body), &dir, &cancel, &mut |_| {
            chunks += 1;
            if chunks == 2 {
                cancel.store(true, Ordering::Release);
            }
        })
        .unwrap_err();
        assert!(error.to_string().contains("cancelled"), "{error}");
        assert_eq!(entries(&dir), ["model.bin.part"], "queda para reanudar");
    }

    #[test]
    fn a_cut_download_resumes_with_a_range_request_and_verifies_the_whole_file() {
        let body = payload();
        let server = TestServer::start(vec![("/m", resumable_route(&body, Some(60_000)))]);
        let dir = scratch("resume");
        let spec = spec_for(&server, "/m", &body);

        let first = fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(matches!(first, CoreError::Model(_)), "{first}");
        assert_eq!(
            fs::metadata(dir.join("model.bin.part")).unwrap().len(),
            60_000
        );

        let mut seen = Vec::new();
        fetch(&spec, &dir, &AtomicBool::new(false), &mut |n| seen.push(n)).unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
        assert_eq!(entries(&dir), ["model.bin"]);
        assert_eq!(
            server.ranges("/m"),
            [None, Some("bytes=60000-".to_owned())],
            "la segunda petición pide solo lo que falta"
        );
        assert_eq!(seen[0], 60_000, "el progreso parte de lo ya descargado");
        assert_eq!(seen.iter().sum::<u64>(), body.len() as u64);
    }

    #[test]
    fn a_server_that_ignores_range_restarts_from_scratch() {
        let body = payload();
        let server = TestServer::start(vec![("/m", Route::Body(body.clone()))]);
        let dir = scratch("norange");
        fs::write(dir.join("model.bin.part"), &body[..30_000]).unwrap();
        let mut seen = 0;
        fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |n| seen += n,
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
        assert_eq!(seen, body.len() as u64, "sin sumar el parcial descartado");
        assert_eq!(entries(&dir), ["model.bin"]);
    }

    #[test]
    fn a_range_not_satisfiable_answer_restarts_from_scratch() {
        let body = payload();
        let server = TestServer::start(vec![("/m", Route::RejectsRange(body.clone()))]);
        let dir = scratch("416");
        fs::write(dir.join("model.bin.part"), &body[..30_000]).unwrap();
        fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
        assert_eq!(server.hits("/m"), 2, "un intento con Range y otro completo");
    }

    #[test]
    fn a_corrupt_partial_fails_the_final_check_and_is_discarded() {
        let body = payload();
        let server = TestServer::start(vec![("/m", resumable_route(&body, None))]);
        let dir = scratch("badpart");
        let mut wrong = body[..40_000].to_vec();
        wrong[5] ^= 0xff;
        fs::write(dir.join("model.bin.part"), &wrong).unwrap();
        let spec = spec_for(&server, "/m", &body);
        let error = fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(error.to_string().contains("corrupt"), "{error}");
        assert!(entries(&dir).is_empty(), "el parcial malo se descarta");

        fetch(&spec, &dir, &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
    }

    #[test]
    fn an_oversized_partial_is_ignored() {
        let body = payload();
        let server = TestServer::start(vec![("/m", resumable_route(&body, None))]);
        let dir = scratch("oversized");
        fs::write(dir.join("model.bin.part"), vec![0u8; body.len() + 5]).unwrap();
        fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("model.bin")).unwrap(), body);
        assert_eq!(server.ranges("/m"), [None]);
    }

    #[test]
    fn nothing_is_written_outside_the_model_directory() {
        let body = payload();
        let server = TestServer::start(vec![("/m", Route::Body(body.clone()))]);
        let root = scratch("scope");
        let dir = root.join("model");
        fs::create_dir_all(&dir).unwrap();
        fetch(
            &spec_for(&server, "/m", &body),
            &dir,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(entries(&root), ["model"]);
        assert_eq!(entries(&dir), ["model.bin"]);
    }
}
