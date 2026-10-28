//! Arranque y parada repetidos sin hilos colgados.
//!
//! Va en su propio binario de test con una única prueba: el conteo de hilos es del
//! proceso completo y otras pruebas en paralelo lo falsearían.
//!
//! Solo Linux: cuenta hilos con `/proc/self/task` (sin equivalente seguro en Windows/macOS).
#![cfg(target_os = "linux")]

use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tr_core::fallback::FallbackConfig;
use tr_core::runner::LoopTiming;
use tr_core::testing::RecordingSink;
use tr_core::{Lang, Region};
use tr_engine::{Engine, EngineConfig};

fn thread_count() -> usize {
    fs::read_dir("/proc/self/task").unwrap().count()
}

/// Espera a que el conteo baje a `expected` (la salida de un hilo es asíncrona respecto a `join`).
fn settle(expected: usize) -> usize {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let now = thread_count();
        if now <= expected || Instant::now() >= deadline {
            return now;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn repeated_start_stop_leaves_no_threads_behind() {
    let sink = RecordingSink::new();
    let config = EngineConfig {
        timing: LoopTiming {
            interval: Duration::from_millis(5),
            idle_interval: Duration::from_millis(5),
        },
        fake_audio_pace: Duration::from_millis(2),
        fallback: Some(FallbackConfig {
            no_text_for: Duration::from_millis(50),
            text_for: Duration::from_millis(50),
        }),
        ..EngineConfig::default()
    };
    let mut engine = Engine::new(config, Arc::new(sink.clone()));
    let region = Region::new(0, 0, 32, 32, 0).unwrap();
    let (en, es) = (Lang::new("en").unwrap(), Lang::new("es").unwrap());

    let baseline = thread_count();
    for round in 0..10 {
        if round % 2 == 0 {
            engine
                .start_region(region, en.clone(), vec![es.clone()])
                .unwrap();
        } else {
            engine
                .start_audio(en.clone(), vec![es.clone()], tr_core::AudioSource::System)
                .unwrap();
        }
        std::thread::sleep(Duration::from_millis(30));
        engine.stop();
        assert_eq!(
            settle(baseline),
            baseline,
            "hilos colgados tras la ronda {round}"
        );
    }

    // Reemplazo directo sin stop intermedio.
    engine
        .start_region(region, en.clone(), vec![es.clone()])
        .unwrap();
    engine
        .start_audio(en, vec![es], tr_core::AudioSource::System)
        .unwrap();
    engine.stop();
    assert_eq!(settle(baseline), baseline, "hilos colgados tras reemplazar");

    // Soltar el Engine en marcha también libera todo.
    {
        let mut running = Engine::new(EngineConfig::default(), Arc::new(sink));
        running
            .start_region(
                region,
                Lang::new("en").unwrap(),
                vec![Lang::new("es").unwrap()],
            )
            .unwrap();
    }
    assert_eq!(
        settle(baseline),
        baseline,
        "hilos colgados tras soltar el Engine"
    );
}
