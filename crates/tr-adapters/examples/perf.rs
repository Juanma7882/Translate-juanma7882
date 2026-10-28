//! Mediciones de rendimiento de los adaptadores (Hito 5A). Solo imprime NÚMEROS (milisegundos,
//! MiB, puntuaciones): ni textos, ni imágenes, ni audio salen a consola ni a disco. Método y
//! presupuestos en `docs/perf/hito-5.md`.
//!
//! `TR_MODELS_DIR=<carpeta> cargo run --release -p tr-adapters --example perf -- <mt|ocr|stt|frame>`
//!
//! Variables (todas opcionales): `TR_MT_DIR` (carpeta del par, por defecto `mt-opus-en-es`),
//! `TR_BEAMS`, `TR_THREADS` (0 = automático), `TR_OCR_MAX_SIDE`.

#![allow(clippy::print_stdout)] // única excepción: imprime cifras, nunca contenido.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tr_adapters::perf::PerfConfig;
use tr_core::{Frame, Lang, OcrEngine, Translator};

fn models() -> PathBuf {
    PathBuf::from(std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR"))
}

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn env_num<T: std::str::FromStr>(name: &str) -> Option<T> {
    std::env::var(name).ok()?.parse().ok()
}

fn perf_config() -> PerfConfig {
    let mut config = PerfConfig::default();
    if let Some(v) = env_num("TR_BEAMS") {
        config.beam_size = v;
    }
    if let Some(v) = env_num("TR_THREADS") {
        config.intra_threads = v;
    }
    if std::env::var_os("TR_LOWMEM").is_some() {
        config.low_memory = true;
    }
    if let Some(v) = env_num("TR_OCR_MAX_SIDE") {
        config.ocr_max_side = v;
    }
    config
}

/// Lee un campo de `/proc/self/status` en MiB (Linux).
fn proc_mib(field: &str) -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with(field))
                .and_then(|l| l.split_whitespace().nth(1)?.parse::<f64>().ok())
        })
        .map_or(0.0, |kib| kib / 1024.0)
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn median(mut v: Vec<Duration>) -> f64 {
    v.sort();
    ms(v[v.len() / 2])
}

fn report_mem(label: &str) {
    println!(
        "{label}: rss={:.0} MiB pico={:.0} MiB",
        proc_mib("VmRSS:"),
        proc_mib("VmHWM:")
    );
}

/// Frases de prueba con una traducción de referencia escrita a mano (para chrF).
const PAIRS: [(&str, &str); 14] = [
    ("Hello, how are you?", "Hola, ¿cómo estás?"),
    (
        "Where is the train station?",
        "¿Dónde está la estación de tren?",
    ),
    ("I will not let you down.", "No te decepcionaré."),
    (
        "Thank you very much for your help.",
        "Muchas gracias por tu ayuda.",
    ),
    (
        "The meeting has been moved to tomorrow morning.",
        "La reunión se ha pasado para mañana por la mañana.",
    ),
    (
        "Press any button to continue.",
        "Pulsa cualquier botón para continuar.",
    ),
    (
        "You must find the key before the guards return to the castle.",
        "Debes encontrar la llave antes de que los guardias vuelvan al castillo.",
    ),
    (
        "I can't believe you did that without telling me first.",
        "No puedo creer que hicieras eso sin decírmelo primero.",
    ),
    (
        "Save your progress before entering the dungeon.",
        "Guarda tu progreso antes de entrar en la mazmorra.",
    ),
    (
        "The weather is nice today, so we are going to the beach.",
        "Hoy hace buen tiempo, así que vamos a la playa.",
    ),
    (
        "Can you tell me how to get to the museum?",
        "¿Puede decirme cómo llegar al museo?",
    ),
    (
        "She said that she would call me back later tonight.",
        "Dijo que me llamaría más tarde esta noche.",
    ),
    (
        "Your inventory is full. Drop an item to pick up this one.",
        "Tu inventario está lleno. Suelta un objeto para recoger este.",
    ),
    (
        "We need to talk about what happened last night.",
        "Tenemos que hablar de lo que pasó anoche.",
    ),
];

/// chrF (n-gramas de caracteres 1..=6, beta = 2), de 0 a 100.
fn chrf(hypothesis: &str, reference: &str) -> f64 {
    let grams = |text: &str, n: usize| -> HashMap<Vec<char>, usize> {
        let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
        let mut map = HashMap::new();
        for window in chars.windows(n) {
            *map.entry(window.to_vec()).or_insert(0) += 1;
        }
        map
    };
    let (mut precision, mut recall, mut used) = (0.0, 0.0, 0.0);
    for n in 1..=6 {
        let (h, r) = (grams(hypothesis, n), grams(reference, n));
        let (th, tr): (usize, usize) = (h.values().sum(), r.values().sum());
        if th == 0 || tr == 0 {
            continue;
        }
        let hits: usize = h
            .iter()
            .map(|(g, &c)| c.min(r.get(g).copied().unwrap_or(0)))
            .sum();
        precision += hits as f64 / th as f64;
        recall += hits as f64 / tr as f64;
        used += 1.0;
    }
    if used == 0.0 {
        return 0.0;
    }
    let (p, r) = (precision / used, recall / used);
    if p + r == 0.0 {
        0.0
    } else {
        100.0 * 5.0 * p * r / (4.0 * p + r)
    }
}

fn mt() {
    #[cfg(feature = "translate-opus")]
    {
        use tr_adapters::translate::OpusMt;
        let name = std::env::var("TR_MT_DIR").unwrap_or_else(|_| "mt-opus-en-es".into());
        let config = perf_config();
        let started = Instant::now();
        let mt =
            OpusMt::load_with(&models().join(name), &lang("en"), &lang("es"), &config).unwrap();
        println!(
            "mt carga: {:.0} ms (cache KV: {}, haces: {}, hilos: {})",
            ms(started.elapsed()),
            mt.uses_kv_cache(),
            config.beams(),
            config.threads_capped(2)
        );
        let (en, es) = (lang("en"), lang("es"));
        mt.translate("warm up", &en, &es).unwrap();
        let (mut medians, mut scores) = (Vec::new(), Vec::new());
        for (source, reference) in PAIRS {
            let mut outputs = Vec::new();
            let times: Vec<Duration> = (0..5)
                .map(|_| {
                    let t = Instant::now();
                    outputs.push(mt.translate(source, &en, &es).unwrap());
                    t.elapsed()
                })
                .collect();
            let m = median(times);
            let score = chrf(&outputs[0], reference);
            println!(
                "mt {:>3} car.: mediana {m:>5.0} ms chrF {score:>5.1}",
                source.len()
            );
            if std::env::var_os("TR_SHOW").is_some() {
                // Solo frases de prueba fijas del repositorio, nunca contenido del usuario.
                println!("   -> {}", outputs[0]);
            }
            medians.push(m);
            scores.push(score);
        }
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        println!(
            "mt RESUMEN: latencia media de medianas {:.0} ms, chrF medio {:.2}",
            mean(&medians),
            mean(&scores)
        );
        report_mem("mt memoria");
    }
}

fn fixture(name: &str) -> Frame {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let rgba = image::open(path).unwrap().to_rgba8();
    Frame::new(rgba.width(), rgba.height(), rgba.into_raw()).unwrap()
}

/// Lienzo de `w`x`h` blanco con la imagen `name` pegada arriba a la izquierda.
fn canvas(name: &str, w: u32, h: u32) -> Frame {
    let src = fixture(name);
    let mut rgba = vec![255u8; (w * h * 4) as usize];
    for y in 0..src.height.min(h) {
        for x in 0..src.width.min(w) {
            let (s, d) = (
                ((y * src.width + x) * 4) as usize,
                ((y * w + x) * 4) as usize,
            );
            rgba[d..d + 4].copy_from_slice(&src.rgba[s..s + 4]);
        }
    }
    Frame::new(w, h, rgba).unwrap()
}

fn ocr() {
    #[cfg(feature = "ocr-paddle")]
    {
        use tr_adapters::ocr::PaddleOcr;
        let config = perf_config();
        let started = Instant::now();
        let mut ocr =
            PaddleOcr::load_with(&models().join("ocr-ppocrv6-small"), &["en", "ja"], &config)
                .unwrap();
        println!(
            "ocr carga: {:.0} ms (hilos: {}, lado max: {})",
            ms(started.elapsed()),
            config.threads(),
            config.ocr_max_side
        );
        let en = lang("en");
        ocr.recognize(&fixture("en1.png"), &en).unwrap();
        for (label, frame) in [
            ("subtitulo 495x79", fixture("en1.png")),
            ("lienzo 1280x200", canvas("en1.png", 1280, 200)),
            ("lienzo 1280x720", canvas("en1.png", 1280, 720)),
            ("lienzo 1920x1080", canvas("en1.png", 1920, 1080)),
            ("lienzo 2560x1440", canvas("en1.png", 2560, 1440)),
            ("sin texto 60x79", fixture("blank.png")),
        ] {
            let mut chars = 0;
            let times: Vec<Duration> = (0..5)
                .map(|_| {
                    let t = Instant::now();
                    let blocks = ocr.recognize(&frame, &en).unwrap();
                    let elapsed = t.elapsed();
                    chars = blocks.iter().map(|b| b.text.chars().count()).sum::<usize>();
                    elapsed
                })
                .collect();
            println!(
                "ocr {label}: mediana {:.0} ms ({chars} caracteres leidos)",
                median(times)
            );
        }
        report_mem("ocr memoria");
    }
}

fn wav(name: &str) -> Vec<f32> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let bytes = std::fs::read(path).unwrap();
    let data = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
    bytes[data..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0)
        .collect()
}

fn stt() {
    #[cfg(feature = "stt-whisper")]
    {
        use tr_adapters::stt::WhisperStt;
        let config = perf_config();
        let started = Instant::now();
        let mut stt =
            WhisperStt::load_with(&models().join("stt-whisper-base"), &lang("en"), &config)
                .unwrap();
        println!(
            "stt carga: {:.0} ms (hilos: {})",
            ms(started.elapsed()),
            config.threads()
        );
        let samples = wav("speech_en.wav");
        println!("stt audio: {:.1} s", samples.len() as f64 / 16_000.0);
        stt.transcribe(&samples).unwrap();
        let times: Vec<Duration> = (0..3)
            .map(|_| {
                let t = Instant::now();
                stt.transcribe(&samples).unwrap();
                t.elapsed()
            })
            .collect();
        println!("stt transcribir: mediana {:.0} ms", median(times));
        report_mem("stt memoria");
    }
}

fn frame() {
    use tr_core::change::{ChangeConfig, ChangeDetector};
    for (w, h) in [(495u32, 79u32), (1280, 720), (1920, 1080)] {
        let a = Frame::solid(w, h, 10);
        let b = Frame::solid(w, h, 200);
        let mut det = ChangeDetector::new(ChangeConfig::default());
        det.changed(&a);
        let times: Vec<Duration> = (0..20)
            .map(|i| {
                let t = Instant::now();
                det.changed(if i % 2 == 0 { &b } else { &a });
                t.elapsed()
            })
            .collect();
        println!(
            "deteccion de cambio {w}x{h}: mediana {:.3} ms",
            median(times)
        );
    }
}

/// Latencia de audio: ventana de voz -> transcripción -> traducción (lo que tarda un subtítulo
/// una vez cerrada la ventana). Carga STT y traducción como el motor: a la vez.
fn audio() {
    #[cfg(all(feature = "stt-whisper", feature = "translate-opus"))]
    {
        use tr_adapters::stt::WhisperStt;
        use tr_adapters::translate::OpusMt;
        let config = perf_config();
        let started = Instant::now();
        let (stt, mt) = std::thread::scope(|scope| {
            let stt = scope.spawn(|| {
                WhisperStt::load_with(&models().join("stt-whisper-base"), &lang("en"), &config)
                    .unwrap()
            });
            let mt = OpusMt::load_with(
                &models().join("mt-opus-en-es"),
                &lang("en"),
                &lang("es"),
                &config,
            )
            .unwrap();
            (stt.join().unwrap(), mt)
        });
        let mut stt = stt;
        println!(
            "audio carga (STT y traduccion a la vez): {:.0} ms",
            ms(started.elapsed())
        );
        let samples = wav("speech_en.wav");
        println!("audio ventana: {:.1} s", samples.len() as f64 / 16_000.0);
        let (en, es) = (lang("en"), lang("es"));
        let run = |stt: &mut WhisperStt| {
            let t = Instant::now();
            let text = stt.transcribe(&samples).unwrap().unwrap().text;
            let heard = t.elapsed();
            mt.translate(&text, &en, &es).unwrap();
            (heard, t.elapsed())
        };
        run(&mut stt);
        let runs: Vec<_> = (0..3).map(|_| run(&mut stt)).collect();
        println!(
            "audio ventana -> subtitulo: mediana {:.0} ms (transcribir {:.0} ms)",
            median(runs.iter().map(|r| r.1).collect()),
            median(runs.iter().map(|r| r.0).collect())
        );
        report_mem("audio memoria");
    }
}

/// Captura real de regiones (necesita pantalla: `scripts/with-xvfb.sh`).
fn capture() {
    #[cfg(feature = "screen-xcap")]
    {
        use tr_adapters::screen::XcapScreen;
        use tr_core::{Region, ScreenCapture};
        let mut screen = XcapScreen::new();
        for (w, h) in [(800u32, 150u32), (1280, 720)] {
            let region = Region::new(0, 0, w, h, 0).unwrap();
            screen.grab(&region).unwrap();
            let times: Vec<Duration> = (0..20)
                .map(|_| {
                    let t = Instant::now();
                    screen.grab(&region).unwrap();
                    t.elapsed()
                })
                .collect();
            println!("captura {w}x{h}: mediana {:.2} ms", median(times));
        }
        report_mem("captura memoria");
    }
}

/// Nombres y formas de las entradas/salidas de un modelo (metadatos, no contenido).
fn inspect(path: &str) {
    let session = ort::session::Session::builder()
        .unwrap()
        .commit_from_file(path)
        .unwrap();
    for i in session.inputs() {
        println!("in  {} {:?}", i.name(), i.dtype().tensor_shape());
    }
    for o in session.outputs() {
        println!("out {} {:?}", o.name(), o.dtype().tensor_shape());
    }
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("inspect") => inspect(&std::env::args().nth(2).unwrap()),
        Some("mt") => mt(),
        Some("ocr") => ocr(),
        Some("stt") => stt(),
        Some("frame") => frame(),
        Some("capture") => capture(),
        Some("audio") => audio(),
        _ => println!("uso: perf <mt|ocr|stt|frame>"),
    }
}
