//! Reconocimiento de voz con los modelos reales (Whisper base int8).
//!
//! Necesita los modelos: `cargo run -p tr-models --example fetch -- <carpeta> en es audio` y luego
//! `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-adapters --test stt_real -- --ignored --test-threads=1`
//! (en serie: el test de latencia compite por CPU con los demás).
//! Los WAV de `tests/fixtures` (16 kHz, mono) se sintetizaron con voces SAPI de Windows (David en
//! inglés, Helena en español).

#![cfg(feature = "stt-whisper")]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tr_adapters::stt::WhisperStt;
use tr_core::{AudioChunk, Lang, SegmentKind, SpeechToText};

fn models_dir() -> PathBuf {
    let dir = std::env::var_os("TR_MODELS_DIR")
        .expect("define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera de este archivo)");
    PathBuf::from(dir).join("stt-whisper-base")
}

fn engine(lang: &str) -> WhisperStt {
    WhisperStt::load(&models_dir(), &Lang::new(lang).unwrap()).expect("cargar los modelos de voz")
}

/// Lee un WAV PCM de 16 bits mono a f32.
fn wav(name: &str) -> Vec<f32> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
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
        .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0)
        .collect()
}

fn words(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn english_speech_is_transcribed() {
    let mut stt = engine("en");
    let transcript = stt.transcribe(&wav("speech_en.wav")).unwrap().unwrap();
    let text = words(&transcript.text);
    assert!(
        text.contains("where is the train station") && text.contains("thank you very much"),
        "{text}"
    );
    assert!(transcript.avg_logprob > -1.0 && transcript.no_speech < 0.5);
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn spanish_speech_is_transcribed_with_the_same_models() {
    let mut stt = engine("es");
    let text = words(&stt.transcribe(&wav("speech_es.wav")).unwrap().unwrap().text);
    assert!(
        text.contains("hola") && text.contains("muchas gracias por tu ayuda"),
        "{text}"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn silence_and_noise_produce_no_text() {
    let mut stt = engine("en");
    assert_eq!(stt.transcribe(&vec![0.0; 32_000]).unwrap(), None);
    assert_eq!(stt.transcribe(&[]).unwrap(), None);
    // Ruido determinista de bajo nivel (sin habla).
    let mut seed = 12345u32;
    let noise: Vec<f32> = (0..32_000)
        .map(|_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((seed >> 16) as f32 / 65_536.0 - 0.5) * 0.01
        })
        .collect();
    assert_eq!(stt.transcribe(&noise).unwrap(), None);
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn consecutive_windows_build_partials_and_close_with_a_final() {
    let samples = wav("speech_en.wav");
    let mut stt = engine("en");
    let window = 32_000; // 2 s, como el pipeline
    let mut last = None;
    let mut slowest = Duration::ZERO;
    let windows: Vec<&[f32]> = samples.chunks(window).collect();
    for (i, w) in windows.iter().enumerate() {
        let closes = i + 1 == windows.len();
        let started = Instant::now();
        let start = Duration::from_secs_f64((i * window) as f64 / 16_000.0);
        let segments = stt
            .push_window(&AudioChunk::new(w.to_vec(), start), closes)
            .unwrap();
        slowest = slowest.max(started.elapsed());
        if let Some(segment) = segments.into_iter().next() {
            let expected = if closes {
                SegmentKind::Final
            } else {
                SegmentKind::Partial
            };
            assert_eq!(segment.kind, expected, "ventana {i}");
            last = Some(segment);
        }
    }
    let last = last.expect("hubo un segmento final");
    assert_eq!(last.kind, SegmentKind::Final);
    let text = words(&last.text);
    assert!(
        text.contains("train station") && text.contains("your help"),
        "el final reúne toda la frase: {text}"
    );
    // Tiene que ir más rápido que el tiempo real de una ventana de 2 s.
    assert!(
        slowest < Duration::from_millis(2000),
        "ventana más lenta: {slowest:?}"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn unsupported_languages_are_rejected_when_loading() {
    let error = WhisperStt::load(&models_dir(), &Lang::new("xx").unwrap())
        .err()
        .expect("debe fallar");
    assert!(
        matches!(error, tr_core::CoreError::InvalidArgument(_)),
        "{error}"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn two_threads_transcribe_the_same_text() {
    let perf = tr_adapters::perf::PerfConfig {
        intra_threads: 2,
        ..Default::default()
    };
    let mut stt = WhisperStt::load_with(&models_dir(), &Lang::new("en").unwrap(), &perf).unwrap();
    let text = words(&stt.transcribe(&wav("speech_en.wav")).unwrap().unwrap().text);
    assert!(text.contains("where is the train station"), "{text}");
}
