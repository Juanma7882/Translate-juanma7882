//! Captura real del audio del sistema (Linux: monitor de PulseAudio/PipeWire).
//!
//! Necesita un servidor de sonido (en WSL, WSLg: `PULSE_SERVER=unix:/mnt/wslg/PulseServer`):
//! `cargo test -p tr-adapters --test audio_real -- --ignored`.
//! En Windows y macOS la captura (cpal) se valida a mano: `docs/validation/windows-hito-3.md`.

#![cfg(all(feature = "audio-loopback", target_os = "linux"))]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tr_adapters::audio::{CHUNK_SAMPLES, PulseLoopback};
use tr_core::{AudioCapture, AudioChunk};

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
fn the_output_monitor_delivers_mono_16khz_chunks_in_real_time() {
    let chunks: Arc<Mutex<Vec<AudioChunk>>> = Arc::default();
    let sink = chunks.clone();
    let mut capture = PulseLoopback::new();
    capture
        .start(Box::new(move |c| sink.lock().unwrap().push(c)))
        .expect("abrir el monitor de salida");
    assert!(
        wait_for(Duration::from_secs(5), || chunks.lock().unwrap().len()
            >= 10),
        "no llegó audio del monitor"
    );
    capture.stop();

    let received = chunks.lock().unwrap().clone();
    assert!(received.iter().all(|c| c.samples.len() == CHUNK_SAMPLES));
    for pair in received.windows(2) {
        assert_eq!(pair[1].start - pair[0].start, Duration::from_millis(100));
    }
    assert!(
        received
            .iter()
            .flat_map(|c| &c.samples)
            .all(|s| s.abs() <= 1.0),
        "muestras fuera de rango"
    );

    // Tras detener no llega nada más.
    let count = chunks.lock().unwrap().len();
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(chunks.lock().unwrap().len(), count);
}

#[test]
#[ignore = "necesita un servidor PulseAudio/PipeWire"]
fn capture_can_be_restarted_and_stop_is_idempotent() {
    let chunks: Arc<Mutex<usize>> = Arc::default();
    let mut capture = PulseLoopback::new();
    capture.stop(); // sin arrancar
    for _ in 0..2 {
        let counter = chunks.clone();
        capture
            .start(Box::new(move |_| *counter.lock().unwrap() += 1))
            .unwrap();
        assert!(
            capture.start(Box::new(|_| {})).is_err(),
            "no se puede arrancar dos veces"
        );
        let before = *chunks.lock().unwrap();
        assert!(wait_for(Duration::from_secs(5), || *chunks.lock().unwrap() > before));
        capture.stop();
        capture.stop();
    }
}

#[test]
fn without_a_sound_server_start_reports_a_capture_error() {
    let mut capture = PulseLoopback::with_socket("/definitely/not/here/pulse-native");
    let error = capture.start(Box::new(|_| {})).unwrap_err();
    assert!(matches!(error, tr_core::CoreError::Capture(_)), "{error}");
    capture.stop(); // nada que detener
}
