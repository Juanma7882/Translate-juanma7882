//! Fallback texto -> audio -> texto con motores y modelos reales, de punta a punta: una ventana X
//! muestra un texto (se traduce), se retira (tras la espera pasa a audio), se reproduce una frase
//! por la salida de sonido (llega el subtítulo traducido) y el texto vuelve (regresa a modo texto).
//!
//! Necesita los modelos de texto y de audio, un servidor X y PulseAudio/PipeWire (WSLg):
//! `cargo run --release -p tr-models --example fetch -- <carpeta> en es all` y luego
//! `TR_MODELS_DIR=<carpeta> scripts/with-xvfb.sh cargo test --release -p tr-engine --test real_fallback -- --ignored`
//!
//! La imagen y el audio salen de `tr-adapters/tests/fixtures`; nada se escribe a disco.

#![cfg(all(
    target_os = "linux",
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus",
    feature = "stt-whisper",
    feature = "audio-loopback"
))]

use std::ffi::CString;
use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use pulseaudio::protocol;
use tr_core::fallback::FallbackConfig;
use tr_core::runner::LoopTiming;
use tr_core::testing::RecordingSink;
use tr_core::{Event, Lang, Mode, Region};
use tr_engine::{Engine, EngineConfig, EngineKind};
use xcb::x;

const WIN_X: i16 = 80;
const WIN_Y: i16 = 40;

fn models_dir() -> PathBuf {
    PathBuf::from(
        std::env::var_os("TR_MODELS_DIR")
            .expect("define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera)"),
    )
}

/// Muestra `fixture` en una ventana sin marco en (`WIN_X`, `WIN_Y`); devuelve su tamaño y la
/// conexión (la ventana vive mientras ésta exista).
fn show_image(fixture: &str) -> (xcb::Connection, u32, u32) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tr-adapters/tests/fixtures")
        .join(fixture);
    let rgba = image::open(path).expect("abrir el fixture").to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    let (conn, screen_num) = xcb::Connection::connect(None)
        .expect("conectar con el servidor X (usa scripts/with-xvfb.sh)");
    let (root, visual) = {
        let screen = conn.get_setup().roots().nth(screen_num as usize).unwrap();
        (screen.root(), screen.root_visual())
    };
    let window: x::Window = conn.generate_id();
    conn.send_request(&x::CreateWindow {
        depth: x::COPY_FROM_PARENT as u8,
        wid: window,
        parent: root,
        x: WIN_X,
        y: WIN_Y,
        width: width as u16,
        height: height as u16,
        border_width: 0,
        class: x::WindowClass::InputOutput,
        visual,
        value_list: &[x::Cw::BackPixel(0x00ff_ffff), x::Cw::OverrideRedirect(true)],
    });
    conn.send_request(&x::MapWindow { window });

    // Píxeles en el orden del servidor (profundidad 24 en 32 bits: B, G, R, sin usar).
    let data: Vec<u8> = rgba.pixels().flat_map(|p| [p[2], p[1], p[0], 0]).collect();
    let gc: x::Gcontext = conn.generate_id();
    conn.send_request(&x::CreateGc {
        cid: gc,
        drawable: x::Drawable::Window(window),
        value_list: &[],
    });
    conn.send_request(&x::PutImage {
        format: x::ImageFormat::ZPixmap,
        drawable: x::Drawable::Window(window),
        gc,
        width: width as u16,
        height: height as u16,
        dst_x: 0,
        dst_y: 0,
        left_pad: 0,
        depth: 24,
        data: &data,
    });
    conn.flush().expect("enviar la imagen al servidor X");
    std::thread::sleep(Duration::from_millis(400));
    (conn, width, height)
}

fn wav(name: &str) -> Vec<i16> {
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

/// Reproduce `samples` (16 kHz, mono, s16) por la salida por defecto y vuelve al terminar.
fn play(samples: &[i16]) {
    let path = pulseaudio::socket_path_from_env().expect("servidor de sonido");
    let mut sock = BufReader::new(UnixStream::connect(path).unwrap());
    let version = protocol::MAX_VERSION;
    let auth = protocol::AuthParams {
        version,
        supports_shm: false,
        supports_memfd: false,
        cookie: pulseaudio::cookie_path_from_env()
            .and_then(|p| std::fs::read(p).ok())
            .filter(|c| c.len() == 256)
            .unwrap_or_else(|| vec![0; 256]),
    };
    protocol::write_command_message(sock.get_mut(), 0, &protocol::Command::Auth(auth), version)
        .unwrap();
    let (_, reply) =
        protocol::read_reply_message::<protocol::AuthReply>(&mut sock, version).unwrap();
    let version = version.min(reply.version);
    let mut props = protocol::Props::new();
    props.set(
        protocol::Prop::ApplicationName,
        CString::new("translate-test").unwrap(),
    );
    protocol::write_command_message(
        sock.get_mut(),
        1,
        &protocol::Command::SetClientName(props),
        version,
    )
    .unwrap();
    protocol::read_reply_message::<protocol::SetClientNameReply>(&mut sock, version).unwrap();

    protocol::write_command_message(
        sock.get_mut(),
        99,
        &protocol::Command::CreatePlaybackStream(protocol::PlaybackStreamParams {
            sample_spec: protocol::SampleSpec {
                format: protocol::SampleFormat::S16Le,
                channels: 1,
                sample_rate: 16_000,
            },
            channel_map: protocol::ChannelMap::mono(),
            cvolume: Some(protocol::ChannelVolume::norm(1)),
            sink_name: Some(protocol::DEFAULT_SINK.to_owned()),
            ..Default::default()
        }),
        version,
    )
    .unwrap();
    let (_, stream) =
        protocol::read_reply_message::<protocol::CreatePlaybackStreamReply>(&mut sock, version)
            .unwrap();

    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let mut offset = 0usize;
    let mut send = |sock: &mut BufReader<UnixStream>, wanted: usize| {
        let end = (offset + wanted).min(bytes.len());
        if end > offset {
            protocol::write_memblock(sock.get_mut(), stream.channel, &bytes[offset..end], 0)
                .unwrap();
            offset = end;
        }
        offset < bytes.len()
    };
    send(&mut sock, stream.requested_bytes as usize);
    let mut draining = false;
    loop {
        let (seq, message) = protocol::read_command_message(&mut sock, version).unwrap();
        match message {
            protocol::Command::Request(request) if !draining => {
                if !send(&mut sock, request.length as usize) {
                    protocol::write_command_message(
                        sock.get_mut(),
                        201,
                        &protocol::Command::DrainPlaybackStream(stream.channel),
                        version,
                    )
                    .unwrap();
                    draining = true;
                }
            }
            protocol::Command::Reply if seq == 201 => return,
            protocol::Command::Error(e) => panic!("error del servidor: {e:?}"),
            _ => {}
        }
    }
}

fn modes(events: &[Event]) -> Vec<Mode> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::ModeChanged { mode } => Some(*mode),
            _ => None,
        })
        .collect()
}

fn translations(events: &[Event]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e, Event::Translation { .. }))
        .count()
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR), un servidor X y un servidor de sonido"]
fn text_falls_back_to_audio_subtitles_and_returns_to_text() {
    let sink = RecordingSink::new();
    let mut engine = Engine::new(
        EngineConfig {
            engines: EngineKind::Real,
            models_dir: Some(models_dir()),
            timing: LoopTiming {
                interval: Duration::from_millis(100),
                idle_interval: Duration::from_millis(200),
            },
            fallback: Some(FallbackConfig {
                no_text_for: Duration::from_millis(1500),
                text_for: Duration::from_millis(800),
            }),
            ..EngineConfig::default()
        },
        Arc::new(sink.clone()),
    );

    // 1. Con texto en la región: modo texto y traducción.
    let (window, width, height) = show_image("en1.png");
    let region = Region::new(i32::from(WIN_X), i32::from(WIN_Y), width, height, 0).unwrap();
    engine
        .start_region(
            region,
            Lang::new("en").unwrap(),
            vec![Lang::new("es").unwrap()],
        )
        .expect("arrancar con motores reales");
    assert!(
        sink.wait_until(Duration::from_secs(60), |e| translations(e) > 0),
        "llega la traducción del texto: {:?}",
        sink.events()
    );
    assert_eq!(modes(&sink.events()), [Mode::Text]);

    // 2. Se retira el texto: tras la espera pasa a audio.
    drop(window);
    assert!(
        sink.wait_until(Duration::from_secs(30), |e| modes(e).contains(&Mode::Audio)),
        "pasa a audio sin texto: {:?}",
        modes(&sink.events())
    );

    // 3. Suena una frase: subtítulo final traducido.
    let mut audio = vec![0i16; 8_000];
    audio.extend(wav("speech_en.wav"));
    audio.extend(vec![0i16; 16_000]);
    std::thread::spawn(move || play(&audio)).join().unwrap();
    assert!(
        sink.wait_until(Duration::from_secs(30), |events| {
            events.iter().any(|e| {
                matches!(e, Event::Subtitle { is_final: true, translations, .. } if translations.first().is_some_and(|t| !t.text.is_empty()))
            })
        }),
        "subtítulo traducido en modo audio"
    );
    let before = translations(&sink.events());

    // 4. Vuelve el texto: regresa a modo texto y se traduce de nuevo.
    let (_window, _, _) = show_image("en1.png");
    assert!(
        sink.wait_until(Duration::from_secs(30), |e| {
            modes(e).ends_with(&[Mode::Audio, Mode::Text])
        }),
        "vuelve a texto: {:?}",
        modes(&sink.events())
    );
    assert!(
        sink.wait_until(Duration::from_secs(30), |e| translations(e) > before),
        "el texto visible se traduce al volver a modo texto"
    );

    engine.stop();
    let events = sink.events();
    assert_eq!(
        modes(&events),
        [Mode::Text, Mode::Audio, Mode::Text],
        "sin parpadeos: solo tres cambios"
    );
    assert!(
        events.iter().all(|e| !matches!(e, Event::Error { .. })),
        "sin errores: {:?}",
        events
            .iter()
            .filter(|e| matches!(e, Event::Error { .. }))
            .collect::<Vec<_>>()
    );
}
