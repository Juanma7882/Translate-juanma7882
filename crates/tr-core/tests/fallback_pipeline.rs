//! Integración: TextOrAudioPipeline con fakes y reloj real (tiempos cortos).

use std::sync::Arc;
use std::time::Duration;

use tr_core::audio::{AudioConfig, AudioProcessor, AudioRunner};
use tr_core::cache::TranslationCache;
use tr_core::clock::SystemClock;
use tr_core::fallback::{FallbackConfig, FallbackSetup, TextOrAudioPipeline};
use tr_core::region::{RegionConfig, RegionProcessor};
use tr_core::runner::LoopTiming;
use tr_core::testing::{FakeAudio, FakeOcr, FakeScreen, FakeStt, FakeTranslator, RecordingSink};
use tr_core::translate::Target;
use tr_core::{AudioChunk, Event, Frame, Lang, Mode, Region, SAMPLE_RATE, Segment, SegmentKind};

const WAIT: Duration = Duration::from_secs(3);

struct Fixture {
    pipeline: TextOrAudioPipeline,
    screen: FakeScreen,
    ocr: FakeOcr,
    audio: FakeAudio,
    stt: FakeStt,
    sink: RecordingSink,
}

fn start() -> Fixture {
    let (screen, ocr, audio, stt) = (
        FakeScreen::new(),
        FakeOcr::new(),
        FakeAudio::new(),
        FakeStt::new(),
    );
    let (translator, sink) = (FakeTranslator::new(), RecordingSink::new());
    let (from, to) = (Lang::new("en").unwrap(), Lang::new("es").unwrap());
    let clock = Arc::new(SystemClock::new());
    let cache = Arc::new(TranslationCache::default());

    let region_processor = RegionProcessor::new(
        RegionConfig::new(from.clone()),
        Box::new(ocr.clone()),
        vec![Target::new(to.clone(), Arc::new(translator.clone()))],
        cache.clone(),
        Arc::new(sink.clone()),
        clock.clone(),
    );
    let audio_processor = AudioProcessor::new(
        AudioConfig::new(from),
        Box::new(stt.clone()),
        vec![Target::new(to, Arc::new(translator))],
        cache,
        Arc::new(sink.clone()),
        clock.clone(),
    );
    let runner = AudioRunner::new(
        Box::new(audio.clone()),
        audio_processor,
        Arc::new(sink.clone()),
    );

    // Tiempos reducidos: 150 ms sin texto -> audio, 100 ms con texto -> texto.
    screen.push_frame(Frame::solid(16, 16, 10));
    let pipeline = TextOrAudioPipeline::start(
        Region::new(0, 0, 16, 16, 0).unwrap(),
        FallbackSetup {
            screen: Box::new(screen.clone()),
            processor: region_processor,
            audio: runner,
            config: FallbackConfig {
                no_text_for: Duration::from_millis(150),
                text_for: Duration::from_millis(100),
            },
            timing: LoopTiming {
                interval: Duration::from_millis(10),
                idle_interval: Duration::from_millis(10),
            },
        },
        clock,
        Arc::new(sink.clone()),
    );
    Fixture {
        pipeline,
        screen,
        ocr,
        audio,
        stt,
        sink,
    }
}

fn translations(events: &[Event]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e, Event::Translation { .. }))
        .count()
}

fn mode_changes(events: &[Event]) -> Vec<Mode> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::ModeChanged { mode } => Some(*mode),
            _ => None,
        })
        .collect()
}

fn speak(audio: &FakeAudio, ms: u64, amplitude: f32, start_ms: u64) {
    let samples = vec![amplitude; (u64::from(SAMPLE_RATE) * ms / 1000) as usize];
    audio.feed(AudioChunk::new(samples, Duration::from_millis(start_ms)));
}

#[test]
fn audio_is_captured_only_while_in_audio_mode() {
    let mut fx = start();

    // 1. Con texto en pantalla: modo texto, sin audio.
    fx.ocr.push_text("hello");
    assert!(fx.sink.wait_until(WAIT, |e| translations(e) == 1));
    assert_eq!(fx.audio.start_count(), 0);
    assert!(!fx.audio.is_running());
    assert_eq!(mode_changes(&fx.sink.events()), [Mode::Text]);

    // 2. La región se queda sin texto: pasa a audio y arranca la captura.
    fx.ocr.push_empty();
    fx.screen.push_frame(Frame::solid(16, 16, 200));
    assert!(
        fx.sink
            .wait_until(WAIT, |e| mode_changes(e).contains(&Mode::Audio))
    );
    assert!(fx.audio.is_running());

    // En modo audio llegan subtítulos y no traducciones de pantalla.
    fx.stt.push_segments(vec![Segment::new(
        "good morning",
        SegmentKind::Final,
        Duration::ZERO,
        Duration::from_secs(1),
    )]);
    for i in 0..4 {
        speak(&fx.audio, 100, 0.5, i * 100);
    }
    for i in 4..7 {
        speak(&fx.audio, 100, 0.0, i * 100);
    }
    assert!(fx.sink.wait_until(WAIT, |e| e.iter().any(|ev| matches!(
        ev,
        Event::Subtitle {
            is_final: true,
            translations,
            ..
        } if !translations.is_empty()
    ))));
    assert_eq!(
        translations(&fx.sink.events()),
        1,
        "sin traducciones de pantalla en modo audio"
    );

    // 3. Vuelve el texto: regresa a modo texto y se detiene el audio.
    fx.ocr.push_text("hello");
    fx.screen.push_frame(Frame::solid(16, 16, 10));
    assert!(fx.sink.wait_until(WAIT, |e| {
        mode_changes(e).ends_with(&[Mode::Audio, Mode::Text])
    }));
    assert!(!fx.audio.is_running());
    assert_eq!(fx.audio.stop_count(), 1);
    assert!(
        fx.sink.wait_until(WAIT, |e| translations(e) == 2),
        "el texto visible se vuelve a traducir al regresar"
    );

    fx.pipeline.stop();
    assert_eq!(
        fx.audio.start_count(),
        1,
        "el audio solo se capturó en modo audio"
    );
}

#[test]
fn pause_stops_screen_and_audio_and_resume_restores_the_mode() {
    let mut fx = start();
    fx.ocr.push_empty();
    assert!(
        fx.sink
            .wait_until(WAIT, |e| mode_changes(e).contains(&Mode::Audio))
    );
    assert!(fx.audio.is_running());

    fx.pipeline.pause();
    assert!(
        fx.sink
            .wait_until(WAIT, |e| mode_changes(e).last() == Some(&Mode::Paused))
    );
    assert!(!fx.audio.is_running());
    std::thread::sleep(Duration::from_millis(60)); // deja terminar una captura en curso
    let calls = fx.screen.calls();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fx.screen.calls(), calls, "en pausa no se captura pantalla");

    fx.pipeline.resume();
    assert!(
        fx.sink
            .wait_until(WAIT, |e| mode_changes(e).last() == Some(&Mode::Audio))
    );
    assert!(fx.audio.is_running());
    fx.pipeline.stop();
    assert!(!fx.audio.is_running());
}

#[test]
fn stop_releases_audio_and_silences_the_pipeline() {
    let mut fx = start();
    fx.ocr.push_empty();
    assert!(
        fx.sink
            .wait_until(WAIT, |e| mode_changes(e).contains(&Mode::Audio))
    );
    fx.pipeline.stop();
    assert!(!fx.audio.is_running());
    let count = fx.sink.len();
    speak(&fx.audio, 100, 0.5, 0);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fx.sink.len(), count);
}
