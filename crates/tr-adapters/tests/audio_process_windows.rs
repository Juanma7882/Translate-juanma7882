//! Captura real por aplicación en Windows (WASAPI process loopback). Necesita Windows 10 2004+,
//! `ffplay` en el PATH y un dispositivo de salida:
//! `cargo test -p tr-adapters --test audio_process_windows -- --ignored --test-threads=1`.

#![cfg(all(feature = "audio-loopback", target_os = "windows"))]

use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tr_adapters::audio::{WindowsAudio, WindowsSourceLister};
use tr_core::{AudioCapture, AudioSource, AudioSourceLister};

const WAV: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/speech_en.wav");

fn spawn_player() -> Child {
    Command::new("taskkill")
        .args(["/F", "/IM", "ffplay.exe"])
        .output()
        .ok();
    Command::new("ffplay")
        .args([
            "-nodisp",
            "-autoexit",
            "-loglevel",
            "error",
            WAV,
            "-loop",
            "20",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("ffplay en el PATH")
}

fn peak_for(source: AudioSource, secs: u64) -> (f32, usize) {
    let peak = Arc::new(Mutex::new((0f32, 0usize)));
    let sink = peak.clone();
    let mut capture = WindowsAudio::new();
    capture
        .start_source(
            &source,
            Box::new(move |c| {
                let mut p = sink.lock().unwrap();
                p.1 += 1;
                p.0 = c.samples.iter().fold(p.0, |m, s| m.max(s.abs()));
            }),
        )
        .expect("abrir la captura");
    std::thread::sleep(Duration::from_secs(secs));
    capture.stop();
    capture.stop();
    *peak.lock().unwrap()
}

#[test]
#[ignore = "necesita Windows 10 2004+, ffplay y salida de audio"]
fn captures_only_the_chosen_application() {
    let mut player = spawn_player();
    std::thread::sleep(Duration::from_secs(2));

    let apps = WindowsSourceLister::new().list().expect("listar");
    let ffplay = apps
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("ffplay.exe"))
        .unwrap_or_else(|| panic!("ffplay no aparece en la lista: {apps:?}"))
        .clone();

    let (peak, chunks) = peak_for(
        AudioSource::Process {
            id: ffplay.id,
            name: ffplay.name.clone(),
        },
        3,
    );
    assert!(chunks >= 10, "pocos trozos: {chunks}");
    assert!(peak > 0.001, "ffplay debería sonar, pico {peak}");

    // ffplay muerto (todas sus copias): pedirlo debe fallar con error descriptivo y sin hilos huérfanos.
    player.kill().ok();
    player.wait().ok();
    Command::new("taskkill")
        .args(["/F", "/IM", "ffplay.exe"])
        .output()
        .ok();
    std::thread::sleep(Duration::from_secs(1));
    let mut capture = WindowsAudio::new();
    let result = capture.start_source(
        &AudioSource::Process {
            id: ffplay.id,
            name: ffplay.name,
        },
        Box::new(|_| {}),
    );
    assert!(result.is_err(), "un proceso inexistente debe dar error");
}

#[test]
#[ignore = "necesita Windows 10 2004+, ffplay y salida de audio"]
fn another_process_is_silent_and_the_end_is_reported() {
    let mut player = spawn_player();
    std::thread::sleep(Duration::from_secs(2));
    let apps = WindowsSourceLister::new().list().expect("listar");
    let ffplay = apps
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("ffplay.exe"))
        .expect("ffplay en la lista")
        .clone();

    // Un proceso ajeno que no suena (ffplay no es su hijo): silencio mientras suena ffplay.
    let mut quiet = Command::new("ping")
        .args(["-n", "30", "127.0.0.1"])
        .stdout(Stdio::null())
        .spawn()
        .expect("ping");
    let (peak, _) = peak_for(
        AudioSource::Process {
            id: quiet.id(),
            name: "ping.exe".into(),
        },
        3,
    );
    quiet.kill().ok();
    quiet.wait().ok();
    assert!(peak < 0.0005, "no debería oír a ffplay, pico {peak}");

    // Fin de la aplicación durante la captura.
    let notified = Arc::new(AtomicBool::new(false));
    let flag = notified.clone();
    let mut capture = WindowsAudio::new();
    capture.set_on_ended(Arc::new(move || flag.store(true, Ordering::SeqCst)));
    capture
        .start_source(
            &AudioSource::Process {
                id: ffplay.id,
                name: ffplay.name,
            },
            Box::new(|_| {}),
        )
        .expect("abrir la captura");
    std::thread::sleep(Duration::from_secs(1));
    player.kill().ok();
    player.wait().ok();
    let end = Instant::now() + Duration::from_secs(5);
    while !notified.load(Ordering::SeqCst) && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(notified.load(Ordering::SeqCst), "no avisó del fin");
    assert!(capture.ended());
    capture.stop();
    capture.stop();
}
