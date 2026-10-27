//! Punta a punta con motores y modelos reales: una ventana X muestra un texto conocido, el motor
//! captura esa región de la pantalla, la reconoce, la traduce y emite el evento.
//!
//! Necesita los modelos y un servidor X:
//! `cargo run --release -p tr-models --example fetch -- <carpeta> en es` y luego
//! `TR_MODELS_DIR=<carpeta> scripts/with-xvfb.sh cargo test --release -p tr-engine --test real_pipeline -- --ignored`

#![cfg(all(
    target_os = "linux",
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus"
))]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tr_core::runner::LoopTiming;
use tr_core::testing::RecordingSink;
use tr_core::{Event, Lang, Region};
use tr_engine::{Engine, EngineConfig, EngineKind};
use xcb::x;

const WIN_X: i16 = 80;
const WIN_Y: i16 = 40;

/// La pantalla X es una sola: los tests no pueden solaparse (la ventana de uno taparía la región
/// «sin texto» de otro). Cada test guarda este cerrojo mientras dura.
static SCREEN: Mutex<()> = Mutex::new(());

fn exclusive_screen() -> MutexGuard<'static, ()> {
    SCREEN.lock().unwrap_or_else(PoisonError::into_inner)
}

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
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

fn models_dir() -> PathBuf {
    PathBuf::from(
        std::env::var_os("TR_MODELS_DIR")
            .expect("define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera)"),
    )
}

fn real_engine() -> (Engine, RecordingSink) {
    let sink = RecordingSink::new();
    let config = EngineConfig {
        engines: EngineKind::Real,
        models_dir: Some(models_dir()),
        timing: LoopTiming {
            interval: Duration::from_millis(100),
            idle_interval: Duration::from_millis(100),
        },
        ..EngineConfig::default()
    };
    (Engine::new(config, Arc::new(sink.clone())), sink)
}

fn translations(events: &[Event]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Translation {
                original,
                translated,
                ..
            } => Some((original.clone(), translated.clone())),
            _ => None,
        })
        .collect()
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y un servidor X"]
fn a_real_screen_region_is_captured_recognized_and_translated() {
    let _screen = exclusive_screen();
    let (_window, width, height) = show_image("en1.png");
    let (mut engine, sink) = real_engine();
    let region = Region::new(i32::from(WIN_X), i32::from(WIN_Y), width, height, 0).unwrap();
    engine
        .start_region(region, lang("en"), lang("es"))
        .expect("arrancar con motores reales");

    assert!(
        sink.wait_until(Duration::from_secs(60), |e| !translations(e).is_empty()),
        "llega una traducción; eventos: {:?}",
        sink.events()
            .iter()
            .filter(|e| matches!(e, Event::Error { .. }))
            .collect::<Vec<_>>()
    );
    let (original, translated) = translations(&sink.events()).remove(0);
    assert_eq!(original, "Hello world, this is a test.");
    let lowered = translated.to_lowercase();
    assert!(
        lowered.contains("mundo") && lowered.contains("prueba"),
        "traducción al español: {translated}"
    );

    // La misma pantalla estable no vuelve a traducirse (cambio de frame detectado y caché).
    let count = translations(&sink.events()).len();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(
        translations(&sink.events()).len(),
        count,
        "sin repeticiones mientras el texto no cambia"
    );

    engine.stop();
    let after = sink.len();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(sink.len(), after, "sin eventos después de stop");
    assert!(
        sink.events()
            .iter()
            .all(|e| !matches!(e, Event::Error { .. })),
        "sin errores durante la sesión"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y un servidor X"]
fn a_region_without_text_produces_no_translation_and_no_error() {
    let _screen = exclusive_screen();
    // Pantalla sin tocar (negra): ni traducción ni error.
    let (mut engine, sink) = real_engine();
    let region = Region::new(0, 0, 300, 100, 0).unwrap();
    engine.start_region(region, lang("en"), lang("es")).unwrap();
    std::thread::sleep(Duration::from_secs(3));
    engine.stop();
    assert!(sink.is_empty(), "eventos inesperados: {:?}", sink.events());
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y un servidor X"]
fn an_unsupported_pair_is_refused_before_the_screen_is_touched() {
    let _screen = exclusive_screen();
    // El OCR sabe japonés, pero el manifiesto no tiene el par ja->es: se rechaza sin capturar nada.
    let (_window, width, height) = show_image("ja1.png");
    let (mut engine, sink) = real_engine();
    let region = Region::new(i32::from(WIN_X), i32::from(WIN_Y), width, height, 0).unwrap();
    let error = engine
        .start_region(region, lang("ja"), lang("es"))
        .unwrap_err();
    assert!(
        error.to_string().contains("unsupported translation pair"),
        "{error}"
    );
    assert!(sink.is_empty());
}
