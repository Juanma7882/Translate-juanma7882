//! Fuentes por aplicación en Linux (PulseAudio/PipeWire). Necesitan un servidor de sonido (en WSL,
//! WSLg: `PULSE_SERVER=unix:/mnt/wslg/PulseServer`):
//! `cargo test -p tr-adapters --test audio_sources_linux -- --ignored --test-threads=1`.
//!
//! El segundo test necesita que alguna aplicación esté reproduciendo audio (p. ej. `paplay` con un
//! WAV largo, o `speaker-test`) mientras corre.

#![cfg(all(feature = "audio-loopback", target_os = "linux"))]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tr_adapters::audio::{CHUNK_SAMPLES, PulseLoopback, PulseSourceLister};
use tr_core::{AudioCapture, AudioChunk, AudioSource, AudioSourceLister};

fn wait_for(timeout: Duration, done: impl Fn() -> bool) -> bool {
    let end = Instant::now() + timeout;
    while Instant::now() < end {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    done()
}

#[test]
#[ignore = "necesita un servidor PulseAudio/PipeWire"]
fn the_lister_answers_without_opening_a_capture() {
    let apps = PulseSourceLister::new().list().expect("listar sink-inputs");
    // Sin nada sonando la lista puede estar vacía; si hay algo, nombres no vacíos y sin duplicados.
    let mut names: Vec<_> = apps.iter().map(|a| a.name.clone()).collect();
    assert!(names.iter().all(|n| !n.is_empty()));
    names.sort();
    names.dedup();
    assert_eq!(names.len(), apps.len());
}

#[test]
#[ignore = "necesita un servidor PulseAudio/PipeWire y una aplicación sonando"]
fn a_playing_application_can_be_captured_alone() {
    let apps = PulseSourceLister::new().list().expect("listar sink-inputs");
    let app = apps.first().expect("ninguna aplicación está sonando");
    let chunks: Arc<Mutex<Vec<AudioChunk>>> = Arc::default();
    let sink = chunks.clone();
    let mut capture = PulseLoopback::new();
    capture
        .start_source(
            &AudioSource::Process {
                id: app.id,
                name: app.name.clone(),
            },
            Box::new(move |c| sink.lock().unwrap().push(c)),
        )
        .expect("abrir el flujo de la aplicación");
    assert!(
        wait_for(Duration::from_secs(5), || chunks.lock().unwrap().len()
            >= 10),
        "no llegó audio de la aplicación"
    );
    capture.stop();
    assert!(
        chunks
            .lock()
            .unwrap()
            .iter()
            .all(|c| c.samples.len() == CHUNK_SAMPLES)
    );
}

#[test]
#[ignore = "necesita un servidor PulseAudio/PipeWire"]
fn a_missing_application_fails_with_a_descriptive_error() {
    let mut capture = PulseLoopback::new();
    let err = capture
        .start_source(
            &AudioSource::Process {
                id: u32::MAX - 1,
                name: "no-such-program".into(),
            },
            Box::new(|_| {}),
        )
        .expect_err("no debe abrir una fuente inexistente");
    assert!(err.to_string().contains("no-such-program"), "{err}");
}
