//! Punta a punta con motores y modelos reales: se reproduce una frase por el dispositivo de salida,
//! el motor captura su monitor (lo que "suena"), la transcribe, la traduce y emite el subtítulo.
//!
//! Necesita los modelos y un servidor PulseAudio/PipeWire (en WSL, WSLg):
//! `cargo run --release -p tr-models --example fetch -- <carpeta> en es audio` y luego
//! `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-engine --test real_audio -- --ignored`
//!
//! El audio reproducido sale de un WAV de `tr-adapters/tests/fixtures`; nada se escribe a disco.

#![cfg(all(
    target_os = "linux",
    feature = "stt-whisper",
    feature = "audio-loopback",
    feature = "translate-opus"
))]

use std::ffi::CString;
use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use pulseaudio::protocol;
use tr_core::testing::RecordingSink;
use tr_core::{Event, Lang};
use tr_engine::{Engine, EngineConfig, EngineKind};

fn models_dir() -> PathBuf {
    PathBuf::from(
        std::env::var_os("TR_MODELS_DIR").expect(
            "define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera de este archivo)",
        ),
    )
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

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y un servidor PulseAudio/PipeWire"]
fn a_phrase_played_on_the_speakers_becomes_a_translated_subtitle() {
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
            vec![Lang::new("es").unwrap()],
            tr_core::AudioSource::System,
        )
        .expect("arrancar los motores reales de audio");

    // Un poco de silencio, la frase y silencio al final para que el VAD cierre la intervención.
    let mut audio = vec![0i16; 8_000];
    audio.extend(wav("speech_en.wav"));
    audio.extend(vec![0i16; 16_000]);
    thread::spawn(move || play(&audio)).join().unwrap();

    let done = sink.wait_until(Duration::from_secs(30), |events| {
        events.iter().any(|e| {
            matches!(e, Event::Subtitle { is_final: true, translations, .. } if translations.first().is_some_and(|t| !t.text.is_empty()))
        })
    });
    engine.stop();
    let events = sink.events();
    assert!(
        done,
        "no llegó ningún subtítulo final traducido: {} eventos",
        events.len()
    );

    let finals: Vec<(String, String)> = events
        .iter()
        .filter_map(|e| match e {
            Event::Subtitle {
                original,
                translated: Some(t),
                is_final: true,
                ..
            } => Some((original.to_lowercase(), t.to_lowercase())),
            _ => None,
        })
        .collect();
    let original: String = finals
        .iter()
        .map(|f| f.0.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let translated: String = finals
        .iter()
        .map(|f| f.1.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(original.contains("train station"), "{original}");
    assert!(
        translated.contains("estación") || translated.contains("tren"),
        "{translated}"
    );
    assert!(
        events.iter().all(|e| !matches!(e, Event::Error { .. })),
        "sin errores"
    );
}
