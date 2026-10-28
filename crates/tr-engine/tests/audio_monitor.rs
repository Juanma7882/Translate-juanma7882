//! Escucha previa del nivel: mide una fuente de audio sin sesión, sin modelos y sin traducir,
//! y cede ante las sesiones. Con los motores de demostración.

use std::sync::Arc;
use std::time::Duration;

use tr_core::testing::RecordingSink;
use tr_core::{AudioSource, CoreError, Event, Lang, Region};
use tr_engine::{Engine, EngineConfig};

const WAIT: Duration = Duration::from_secs(5);

fn config() -> EngineConfig {
    EngineConfig {
        fake_audio_pace: Duration::from_millis(2),
        ..EngineConfig::default()
    }
}

fn engine() -> (Engine, RecordingSink) {
    let sink = RecordingSink::new();
    (Engine::new(config(), Arc::new(sink.clone())), sink)
}

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn region() -> Region {
    Region::new(0, 0, 32, 32, 0).unwrap()
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

/// Espera a que el motor haya emitido algún nivel con señal.
fn wait_for_signal(sink: &RecordingSink) {
    assert!(sink.wait_until(WAIT, |e| {
        levels(e)
            .iter()
            .any(|&(rms, peak)| rms > 0.0 && peak >= rms)
    }));
}

fn assert_silent_for(sink: &RecordingSink, message: &str) {
    let count = sink.len();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(sink.len(), count, "{message}");
}

#[test]
fn the_preview_measures_the_audio_without_any_session() {
    let (mut engine, sink) = engine();
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());
    assert!(engine.is_monitoring());
    assert!(!engine.is_running(), "la escucha no es una sesión");

    wait_for_signal(&sink);
    assert!(
        sink.events()
            .iter()
            .all(|e| matches!(e, Event::AudioLevel { .. })),
        "de la escucha solo salen niveles: ni subtítulos, ni traducciones, ni errores"
    );

    engine.stop_audio_monitor();
    assert!(!engine.is_monitoring());
    assert_silent_for(&sink, "sin niveles después de detener la escucha");
    engine.stop_audio_monitor(); // idempotente
}

#[test]
fn a_demo_application_can_be_listened_to_and_a_missing_one_cannot() {
    let (mut engine, sink) = engine();
    let app = engine.list_audio_sources().unwrap()[0].clone();
    assert!(
        engine
            .start_audio_monitor(AudioSource::Process {
                id: app.id,
                name: app.name,
            })
            .unwrap()
    );
    wait_for_signal(&sink);
    engine.stop_audio_monitor();

    let error = engine
        .start_audio_monitor(AudioSource::Process {
            id: 424_242,
            name: "ghost.exe".into(),
        })
        .unwrap_err();
    assert!(matches!(error, CoreError::Capture(_)), "{error}");
    assert!(!engine.is_monitoring());
    assert!(
        !sink
            .events()
            .iter()
            .any(|e| matches!(e, Event::Error { .. })),
        "un fallo de la escucha no se emite como error de sesión"
    );
}

#[test]
fn starting_the_preview_again_replaces_the_previous_one() {
    let (mut engine, sink) = engine();
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());
    wait_for_signal(&sink);
    engine.stop_audio_monitor();
    assert_silent_for(&sink, "no queda ninguna escucha anterior midiendo");
}

#[test]
fn a_session_replaces_the_preview_and_blocks_a_new_one_until_it_ends() {
    for text in [false, true] {
        let (mut engine, _sink) = engine();
        assert!(engine.start_audio_monitor(AudioSource::System).unwrap());

        if text {
            engine
                .start_region(region(), lang("en"), vec![lang("es")])
                .unwrap();
        } else {
            engine
                .start_audio(lang("en"), vec![lang("es")], AudioSource::System)
                .unwrap();
        }
        assert!(!engine.is_monitoring(), "la escucha cede (texto: {text})");
        assert!(engine.is_running());
        assert!(
            !engine.start_audio_monitor(AudioSource::System).unwrap(),
            "con una sesión en marcha la escucha no arranca (texto: {text})"
        );
        assert!(!engine.is_monitoring());

        engine.stop();
        assert!(
            engine.start_audio_monitor(AudioSource::System).unwrap(),
            "al terminar la sesión puede volver a escuchar (texto: {text})"
        );
        engine.stop_audio_monitor();
    }
}

#[test]
fn stopping_a_session_does_not_touch_the_preview() {
    let (mut engine, _sink) = engine();
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());
    engine.stop(); // sin sesión: no hace nada a la escucha
    assert!(engine.is_monitoring());
    engine.stop_audio_monitor();
}

#[test]
fn dropping_the_engine_closes_the_preview() {
    let (mut engine, sink) = engine();
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());
    wait_for_signal(&sink);
    drop(engine);
    assert_silent_for(&sink, "sin niveles después de soltar el motor");
}

#[test]
fn a_new_engine_adopts_the_running_preview() {
    let sink = RecordingSink::new();
    let mut old = Engine::new(config(), Arc::new(sink.clone()));
    assert!(old.start_audio_monitor(AudioSource::System).unwrap());
    wait_for_signal(&sink);

    let mut new = Engine::new(config(), Arc::new(sink.clone()));
    new.adopt_monitor_from(&mut old);
    assert!(!old.is_monitoring() && new.is_monitoring());
    drop(old); // `configure` suelta el motor anterior

    let before = sink.len();
    assert!(
        sink.wait_until(WAIT, |e| e.len() > before + 3),
        "la escucha sigue midiendo tras soltar el motor anterior"
    );
    new.stop_audio_monitor();
}

#[test]
fn adopting_from_an_engine_without_a_preview_keeps_the_current_one() {
    let sink = RecordingSink::new();
    let mut old = Engine::new(config(), Arc::new(sink.clone()));
    let mut new = Engine::new(config(), Arc::new(sink.clone()));
    assert!(new.start_audio_monitor(AudioSource::System).unwrap());
    new.adopt_monitor_from(&mut old);
    assert!(new.is_monitoring());
    new.stop_audio_monitor();
}

/// Con el motor real y sin modelos, un arranque de sesión que falla antes de tocar nada no apaga
/// la escucha. Abre el dispositivo de salida de verdad: `cargo test -p tr-engine --test
/// audio_monitor -- --ignored`.
#[test]
#[ignore = "necesita un dispositivo de salida de audio"]
#[cfg(all(
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus",
    feature = "audio-loopback"
))]
fn a_session_that_fails_on_missing_models_leaves_the_real_preview_running() {
    use tr_engine::EngineKind;

    let dir = std::env::temp_dir().join(format!("tr-monitor-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let sink = RecordingSink::new();
    let mut engine = Engine::new(
        EngineConfig {
            engines: EngineKind::Real,
            models_dir: Some(dir),
            ..EngineConfig::default()
        },
        Arc::new(sink.clone()),
    );
    assert!(engine.start_audio_monitor(AudioSource::System).unwrap());

    let error = engine
        .start_audio(lang("en"), vec![lang("es")], AudioSource::System)
        .unwrap_err();
    assert!(matches!(error, CoreError::Model(_)), "{error}");
    assert!(engine.is_monitoring(), "faltaban modelos: la escucha sigue");
    engine.stop_audio_monitor();
}
