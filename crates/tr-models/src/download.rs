//! Descarga de un archivo: `.part` + SHA-256 en streaming + `rename` atómico.

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
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

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .build()
        .into()
}

/// Descarga `spec` en `dir/<name>`. Solo deja el archivo final si su tamaño y su huella
/// coinciden con el manifiesto; en cualquier otro caso no queda nada (ni parcial).
/// `on_bytes` recibe el tamaño de cada trozo recibido.
pub(crate) fn fetch(
    spec: &FileSpec,
    dir: &Path,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<()> {
    let part = dir.join(format!("{}.part", spec.name));
    let result = download_to(spec, dir, &part, cancel, on_bytes);
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

fn download_to(
    spec: &FileSpec,
    dir: &Path,
    part: &Path,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<()> {
    let name = &spec.name;
    let response = agent()
        .get(&spec.url)
        .call()
        .map_err(|e| error(format!("could not download `{name}`: {e}")))?;
    let mut reader = response.into_body().into_reader();
    let mut file =
        fs::File::create(part).map_err(|e| error(format!("could not write `{name}`: {e}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut received = 0u64;
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(error("download cancelled"));
        }
        let n = reader
            .read(&mut buffer)
            .map_err(|e| error(format!("network error while downloading `{name}`: {e}")))?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > spec.size {
            return Err(error(format!(
                "`{name}` is larger than expected ({} bytes)",
                spec.size
            )));
        }
        file.write_all(&buffer[..n])
            .map_err(|e| error(format!("could not write `{name}`: {e}")))?;
        hasher.update(&buffer[..n]);
        on_bytes(n as u64);
    }
    file.flush()
        .map_err(|e| error(format!("could not write `{name}`: {e}")))?;
    drop(file);

    if received != spec.size {
        return Err(error(format!(
            "`{name}` is incomplete: expected {} bytes, received {received}",
            spec.size
        )));
    }
    if hex(&hasher.finalize()) != spec.sha256 {
        return Err(error(format!(
            "`{name}` is corrupt: its SHA-256 does not match the manifest"
        )));
    }
    fs::rename(part, dir.join(name)).map_err(|e| error(format!("could not finish `{name}`: {e}")))
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
    fn a_wrong_checksum_is_discarded() {
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
    fn a_cut_connection_leaves_nothing_valid() {
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
        assert!(entries(&dir).is_empty());
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
    fn cancelling_stops_the_download_and_cleans_up() {
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
        assert!(entries(&dir).is_empty());
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
