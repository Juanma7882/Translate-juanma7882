//! Punta a punta en Windows con motores y modelos reales: se reproduce una frase por el dispositivo
//! de salida predeterminado, el motor captura su loopback (fuente "sistema"), emite niveles y
//! produce un subtítulo traducido.
//!
//! Necesita los modelos de audio (`fetch -- <carpeta> en es audio`) y un dispositivo de salida:
//! `$env:TR_MODELS_DIR="<carpeta>"; cargo test --release -p tr-engine --test real_audio_windows -- --ignored --nocapture`
//!
//! El WAV sale de `tr-adapters/tests/fixtures`; se compone en RAM y llega a `SoundPlayer` por la
//! entrada estándar de PowerShell: nada se escribe a disco. El volumen del sistema afecta al nivel
//! (si el subtítulo no sale, el mensaje del fallo trae los máximos medidos frente al umbral).

#![cfg(all(
    target_os = "windows",
    feature = "stt-whisper",
    feature = "audio-loopback",
    feature = "translate-opus"
))]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tr_core::testing::RecordingSink;
use tr_core::{AudioSource, Event, Lang};
use tr_engine::{Engine, EngineConfig, EngineKind};

fn models_dir() -> PathBuf {
    PathBuf::from(
        std::env::var_os("TR_MODELS_DIR").expect(
            "define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera de este archivo)",
        ),
    )
}

fn wav_samples(name: &str) -> Vec<i16> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tr-adapters/tests/fixtures")
        .join(name);
    let bytes = std::fs::read(path).expect("abrir el fixture");
    let data = bytes
        .windows(4)
        .position(|w| w == b"data")
        .expect("chunk data")
        + 8;
    bytes[data..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes(*b))
        .collect()
}

/// WAV PCM de 16 kHz, mono, 16 bits, compuesto en memoria.
fn wav_bytes(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&16_000u32.to_le_bytes());
    out.extend_from_slice(&32_000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend(samples.iter().flat_map(|s| s.to_le_bytes()));
    out
}

/// Reproduce el WAV por la salida predeterminada y vuelve al terminar.
fn play(wav: &[u8]) {
    let script = "$ms = New-Object System.IO.MemoryStream; \
                  [Console]::OpenStandardInput().CopyTo($ms); $ms.Position = 0; \
                  $p = New-Object System.Media.SoundPlayer($ms); $p.PlaySync()";
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("lanzar powershell");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(wav)
        .expect("enviar el audio");
    let status = child.wait().expect("esperar a powershell");
    assert!(status.success(), "SoundPlayer falló: {status}");
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y un dispositivo de salida de audio"]
fn a_phrase_played_on_the_output_device_becomes_levels_and_a_translated_subtitle() {
    let sink = RecordingSink::new();
    let mut engine = Engine::new(
        EngineConfig {
            engines: EngineKind::Real,
            models_dir: Some(models_dir()),
            ..EngineConfig::default()
        },
        Arc::new(sink.clone()),
    );
    engine
        .start_audio(
            Lang::new("en").unwrap(),
            Lang::new("es").unwrap(),
            AudioSource::System,
        )
        .expect("arrancar los motores reales de audio");

    // Silencio, la frase y silencio al final para que el VAD cierre la intervención.
    let mut audio = vec![0i16; 16_000];
    audio.extend(wav_samples("speech_en.wav"));
    audio.extend(vec![0i16; 24_000]);
    let wav = wav_bytes(&audio);
    thread::spawn(move || play(&wav)).join().unwrap();

    let done = sink.wait_until(Duration::from_secs(45), |events| {
        events.iter().any(|e| {
            matches!(e, Event::Subtitle { is_final: true, translated: Some(t), .. } if !t.is_empty())
        })
    });
    engine.stop();
    let events = sink.events();

    let (mut max_rms, mut max_peak, mut count) = (0f32, 0f32, 0usize);
    for event in &events {
        if let Event::AudioLevel { rms, peak } = event {
            max_rms = max_rms.max(*rms);
            max_peak = max_peak.max(*peak);
            count += 1;
        }
    }
    assert!(
        max_peak > 0.0,
        "no llegó nivel de audio (pico 0): {count} niveles"
    );
    assert!(
        done,
        "no llegó ningún subtítulo final traducido (rms max {max_rms:.5}, pico max {max_peak:.5}, umbral {}): {} eventos",
        tr_core::audio::DEFAULT_VAD_THRESHOLD,
        events.len()
    );
    assert!(
        events.iter().all(|e| !matches!(e, Event::Error { .. })),
        "sin errores"
    );
}
