//! Integración del Engine con los motores de demostración.

use std::sync::Arc;
use std::time::Duration;

use tr_core::fallback::FallbackConfig;
use tr_core::runner::LoopTiming;
use tr_core::testing::RecordingSink;
use tr_core::{Event, Lang, Mode, Region};
use tr_engine::{Engine, EngineConfig};

const WAIT: Duration = Duration::from_secs(5);

fn fast_config() -> EngineConfig {
    EngineConfig {
        timing: LoopTiming {
            interval: Duration::from_millis(5),
            idle_interval: Duration::from_millis(5),
        },
        fake_audio_pace: Duration::from_millis(2),
        ..EngineConfig::default()
    }
}

fn engine(config: EngineConfig) -> (Engine, RecordingSink) {
    let sink = RecordingSink::new();
    (Engine::new(config, Arc::new(sink.clone())), sink)
}

fn region() -> Region {
    Region::new(0, 0, 32, 32, 0).unwrap()
}

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn translations(events: &[Event]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Translation {
                original,
                translations,
                ..
            } => Some((original.clone(), translations[0].text.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn region_translation_runs_end_to_end_and_stops() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_region(region(), lang("en"), vec![lang("es")])
        .unwrap();
    assert!(engine.is_running());

    assert!(sink.wait_until(WAIT, |e| translations(e).len() >= 2));
    let first = translations(&sink.events());
    assert_eq!(
        first[0],
        ("Hello, world".into(), "[es] Hello, world".into())
    );
    assert_eq!(first[1].0, "Where is the station?");

    engine.stop();
    assert!(!engine.is_running());
    let count = sink.len();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(sink.len(), count, "sin eventos después de stop");
}

#[test]
fn audio_subtitles_run_end_to_end_and_stop() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_audio(lang("en"), vec![lang("es")], tr_core::AudioSource::System)
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| e.iter().any(|ev| matches!(
        ev,
        Event::Subtitle { original, translations, is_final: true, .. }
            if original == "Good morning everyone"
                && translations.first().is_some_and(|t| t.text == "[es] Good morning everyone")
    ))));
    engine.stop();
    let count = sink.len();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(sink.len(), count);
}

#[test]
fn region_with_fallback_starts_in_text_mode() {
    let config = EngineConfig {
        fallback: Some(FallbackConfig::default()),
        ..fast_config()
    };
    let (mut engine, sink) = engine(config);
    engine
        .start_region(region(), lang("en"), vec![lang("es")])
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| {
        e.first() == Some(&Event::ModeChanged { mode: Mode::Text }) && !translations(e).is_empty()
    }));
    engine.stop();
}

#[test]
fn starting_again_replaces_the_running_pipeline() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_region(region(), lang("en"), vec![lang("es")])
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| !translations(e).is_empty()));
    engine
        .start_audio(lang("en"), vec![lang("fr")], tr_core::AudioSource::System)
        .unwrap();
    sink.take();
    assert!(sink.wait_until(WAIT, |e| {
        e.iter().any(|ev| matches!(ev, Event::Subtitle { .. }))
    }));
    assert!(
        translations(&sink.events()).is_empty(),
        "el pipeline de región ya no emite"
    );
    engine.stop();
}

#[test]
fn stop_returns_quickly_even_with_long_capture_intervals() {
    let config = EngineConfig {
        timing: LoopTiming {
            interval: Duration::from_secs(5),
            idle_interval: Duration::from_secs(5),
        },
        fake_audio_pace: Duration::from_secs(5),
        ..EngineConfig::default()
    };
    let (mut engine, _sink) = engine(config);
    for start_audio in [false, true] {
        if start_audio {
            engine
                .start_audio(lang("en"), vec![lang("es")], tr_core::AudioSource::System)
                .unwrap();
        } else {
            engine
                .start_region(region(), lang("en"), vec![lang("es")])
                .unwrap();
        }
        std::thread::sleep(Duration::from_millis(50)); // los hilos ya están esperando su turno
        let started = std::time::Instant::now();
        engine.stop();
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "stop() tardó {:?}",
            started.elapsed()
        );
    }
}

#[test]
fn pause_and_resume_are_safe_in_every_state() {
    let (mut engine, _sink) = engine(fast_config());
    engine.pause(); // sin nada en marcha
    engine.resume();
    engine
        .start_audio(lang("en"), vec![lang("es")], tr_core::AudioSource::System)
        .unwrap();
    engine.pause(); // el audio puro ignora pausa
    engine.resume();
    engine.stop();
    engine.stop(); // idempotente
}

#[test]
fn the_translation_cache_survives_a_restart_of_the_session() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_region(region(), lang("en"), vec![lang("es")])
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| translations(e).len() >= 2));
    engine.stop();
    let before = engine.cache_stats();
    assert!(before.inserts >= 2, "{before:?}");

    // Nueva sesión con el mismo par: los mismos textos salen de la caché.
    engine
        .start_region(region(), lang("en"), vec![lang("es")])
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| translations(e).len() >= 4));
    engine.stop();
    let after = engine.cache_stats();
    assert!(after.hits > before.hits, "{before:?} -> {after:?}");
}

#[test]
fn the_interface_performance_options_override_the_base_tuning() {
    use tr_engine::PerformanceConfig;
    let mut config = EngineConfig::default();
    config.perf.beam_size = 1;
    config.perf.ocr_max_side = 640;
    assert_eq!(config.perf_config().beam_size, 1);
    config.performance = PerformanceConfig {
        intra_threads: Some(3),
        beam_width: Some(4),
    };
    let perf = config.perf_config();
    assert_eq!((perf.intra_threads, perf.beam_size), (3, 4));
    assert_eq!(
        perf.ocr_max_side, 640,
        "lo que la interfaz no pide se conserva"
    );
}

fn levels(events: &[Event]) -> Vec<(f32, f32)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::AudioLevel { rms, peak } => Some((*rms, *peak)),
            _ => None,
        })
        .collect()
}

#[test]
fn audio_from_a_demo_application_emits_levels_and_subtitles() {
    let (mut engine, sink) = engine(fast_config());
    let apps = engine.list_audio_sources().unwrap();
    assert!(!apps.is_empty());
    let app = apps[0].clone();
    engine
        .start_audio(
            lang("en"),
            vec![lang("es")],
            tr_core::AudioSource::Process {
                id: app.id,
                name: app.name,
            },
        )
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| {
        levels(e)
            .iter()
            .any(|&(rms, peak)| rms > 0.0 && peak >= rms)
            && e.iter().any(|e| matches!(e, Event::Subtitle { .. }))
    }));
    engine.stop();
}

#[test]
fn audio_from_a_missing_application_fails_without_leaving_threads_running() {
    let (mut engine, sink) = engine(fast_config());
    let error = engine
        .start_audio(
            lang("en"),
            vec![lang("es")],
            tr_core::AudioSource::Process {
                id: 424_242,
                name: "ghost.exe".into(),
            },
        )
        .unwrap_err();
    assert!(matches!(error, tr_core::CoreError::Capture(_)), "{error}");
    assert!(!engine.is_running());
    std::thread::sleep(Duration::from_millis(100));
    assert!(levels(&sink.events()).is_empty());
}

#[test]
fn fake_engine_lists_demo_applications() {
    let (engine, _sink) = engine(fast_config());
    let apps = engine.list_audio_sources().unwrap();
    assert!(apps.iter().all(|a| !a.name.is_empty()));
}

fn first_translation_langs(events: &[Event]) -> Option<Vec<(String, String)>> {
    events.iter().find_map(|e| match e {
        Event::Translation {
            original,
            translations,
            ..
        } => Some(
            translations
                .iter()
                .map(|t| (t.lang.to_string(), t.text.clone()))
                .chain([("original".to_owned(), original.clone())])
                .collect(),
        ),
        _ => None,
    })
}

#[test]
fn two_targets_arrive_in_one_event_in_the_order_requested() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_region(region(), lang("en"), vec![lang("fr"), lang("es")])
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| !translations_of(e).is_empty()));
    engine.stop();
    assert_eq!(
        first_translation_langs(&sink.events()).unwrap(),
        [
            ("fr".to_owned(), "[fr] Hello, world".to_owned()),
            ("es".to_owned(), "[es] Hello, world".to_owned()),
            ("original".to_owned(), "Hello, world".to_owned()),
        ]
    );
}

fn translations_of(events: &[Event]) -> Vec<usize> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Translation { translations, .. } => Some(translations.len()),
            _ => None,
        })
        .collect()
}

#[test]
fn without_targets_only_the_original_is_emitted() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_region(region(), lang("en"), Vec::new())
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| !translations_of(e).is_empty()));
    engine.stop();
    assert!(translations_of(&sink.events()).iter().all(|n| *n == 0));
}

#[test]
fn audio_without_targets_emits_untranslated_finals() {
    let (mut engine, sink) = engine(fast_config());
    engine
        .start_audio(lang("en"), Vec::new(), tr_core::AudioSource::System)
        .unwrap();
    assert!(sink.wait_until(WAIT, |e| e.iter().any(|ev| matches!(
        ev,
        Event::Subtitle { is_final: true, translations, .. } if translations.is_empty()
    ))));
    engine.stop();
}

#[test]
fn invalid_target_lists_are_rejected_without_starting_anything() {
    let (mut engine, _sink) = engine(fast_config());
    let cases: [Vec<Lang>; 3] = [
        vec![lang("es"), lang("fr"), lang("de")],
        vec![lang("es"), lang("es")],
        vec![lang("en")],
    ];
    for targets in cases {
        let error = engine
            .start_region(region(), lang("en"), targets.clone())
            .unwrap_err();
        assert!(
            matches!(error, tr_core::CoreError::InvalidArgument(_)),
            "{targets:?}: {error}"
        );
        assert!(!engine.is_running());
    }
}
