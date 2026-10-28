//! El conjunto de motores reales: precondiciones y errores (sin modelos reales).
//! La ejecución de punta a punta con modelos reales está en `real_pipeline.rs`.
//!
//! Estos tests suponen que los tres motores están compilados; sin alguno, el error de "motor no
//! disponible" tiene prioridad y se cubre en los tests de `src/real.rs`.

#![cfg(all(
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus"
))]

use std::path::PathBuf;
use std::sync::Arc;

use tr_core::runner::LoopTiming;
use tr_core::testing::RecordingSink;
use tr_core::{CoreError, Lang, Region};
use tr_engine::{Engine, EngineConfig, EngineKind};

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn region() -> Region {
    Region::new(0, 0, 64, 32, 0).unwrap()
}

fn empty_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tr-engine-it-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn real_engine(tag: &str) -> (Engine, RecordingSink) {
    let sink = RecordingSink::new();
    let config = EngineConfig {
        engines: EngineKind::Real,
        models_dir: Some(empty_dir(tag)),
        ..EngineConfig::default()
    };
    (Engine::new(config, Arc::new(sink.clone())), sink)
}

#[test]
fn engine_sets_are_selected_by_name() {
    assert_eq!("fake".parse::<EngineKind>().unwrap(), EngineKind::Fake);
    assert_eq!("real".parse::<EngineKind>().unwrap(), EngineKind::Real);
    let error = "turbo".parse::<EngineKind>().unwrap_err();
    assert!(
        matches!(&error, CoreError::InvalidArgument(m) if m.contains("turbo")),
        "{error}"
    );
    assert_eq!(EngineKind::default(), EngineKind::Fake);
}

#[test]
fn real_engines_refuse_to_start_without_models_and_list_the_missing_ones() {
    let (mut engine, sink) = real_engine("missing");
    let error = engine
        .start_region(region(), lang("en"), lang("es"))
        .unwrap_err();
    let CoreError::Model(message) = error else {
        panic!("debe ser un error de modelo")
    };
    assert!(
        message.contains("ocr-ppocrv6-small") && message.contains("mt-opus-en-es"),
        "{message}"
    );
    assert!(!engine.is_running(), "no se arrancó ningún pipeline");
    assert!(sink.is_empty(), "no se capturó ni se emitió nada");
}

#[test]
fn unsupported_languages_are_reported_before_looking_at_models() {
    let (mut engine, _sink) = real_engine("unsupported");
    for (from, to) in [("ko", "es"), ("en", "ru")] {
        let error = engine
            .start_region(region(), lang(from), lang(to))
            .unwrap_err();
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{from}->{to}: {error}"
        );
    }
}

#[test]
fn real_audio_lists_the_missing_speech_models_and_starts_nothing() {
    let (mut engine, sink) = real_engine("audio");
    let error = engine.start_audio(lang("en"), lang("es")).unwrap_err();
    let CoreError::Model(message) = error else {
        panic!("debe ser un error de modelo")
    };
    assert!(
        message.contains("stt-whisper-base") && message.contains("mt-opus-en-es"),
        "{message}"
    );
    assert!(
        !message.contains("ocr-"),
        "el audio no necesita OCR: {message}"
    );
    assert!(!engine.is_running());
    assert!(sink.is_empty(), "no se abrió la captura ni se emitió nada");
}

#[test]
fn real_audio_rejects_unsupported_languages_before_looking_at_models() {
    let (mut engine, _sink) = real_engine("audio-lang");
    for (from, to) in [("ko", "es"), ("en", "ru")] {
        let error = engine.start_audio(lang(from), lang(to)).unwrap_err();
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{from}->{to}: {error}"
        );
    }
}

#[test]
fn repeated_failed_real_starts_leave_nothing_running() {
    // Un arranque fallido no deja hilos, pipelines ni eventos, por muchas veces que se repita.
    let (mut engine, sink) = real_engine("failed");
    for _ in 0..3 {
        assert!(
            engine
                .start_region(region(), lang("en"), lang("es"))
                .is_err()
        );
    }
    assert!(!engine.is_running());
    engine.stop(); // idempotente aun sin nada en marcha
    assert!(sink.is_empty());
}

#[test]
fn demo_engines_are_untouched_by_the_real_ones() {
    let sink = RecordingSink::new();
    let config = EngineConfig {
        timing: LoopTiming {
            interval: std::time::Duration::from_millis(5),
            idle_interval: std::time::Duration::from_millis(5),
        },
        ..EngineConfig::default()
    };
    let mut engine = Engine::new(config, Arc::new(sink.clone()));
    engine
        .start_region(region(), lang("en"), lang("es"))
        .unwrap();
    assert!(sink.wait_until(std::time::Duration::from_secs(5), |e| !e.is_empty()));
    engine.stop();
}

#[test]
fn the_models_service_reports_status_for_any_engine_set() {
    let (engine, _sink) = real_engine("status");
    let models = engine.models().unwrap();
    let status = models.status(&lang("en"), &lang("es")).unwrap();
    let ids: Vec<_> = status.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["ocr-ppocrv6-small", "mt-opus-en-es"]);
    assert!(
        status
            .iter()
            .all(|s| s.state == tr_engine::ModelState::Missing && s.size > 1_000_000)
    );
    let audio = models
        .status_for(&lang("en"), &lang("es"), tr_engine::ModelScope::Audio)
        .unwrap();
    let ids: Vec<_> = audio.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["stt-whisper-base", "mt-opus-en-es"]);
}
