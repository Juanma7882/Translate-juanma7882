//! OCR con los modelos reales (PP-OCRv6 small).
//!
//! Necesita los modelos descargados: `cargo run -p tr-models --example fetch -- <carpeta> en es`
//! y luego `TR_MODELS_DIR=<carpeta> cargo test -p tr-adapters --test ocr_real -- --ignored`.
//! Las imágenes de `tests/fixtures` se generaron con Arial y Yu Gothic.

#![cfg(feature = "ocr-paddle")]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tr_adapters::ocr::PaddleOcr;
use tr_core::{CoreError, Frame, Lang, OcrEngine};

fn models_dir() -> PathBuf {
    let dir = std::env::var_os("TR_MODELS_DIR")
        .expect("define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera de este archivo)");
    PathBuf::from(dir).join("ocr-ppocrv6-small")
}

fn engine() -> PaddleOcr {
    PaddleOcr::load(&models_dir(), &["en", "ja"]).expect("cargar los modelos de OCR")
}

fn fixture(name: &str) -> Frame {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let rgba = image::open(path).expect("abrir el fixture").to_rgba8();
    Frame::new(rgba.width(), rgba.height(), rgba.into_raw()).unwrap()
}

fn recognize(engine: &mut PaddleOcr, name: &str, lang: &str) -> Vec<tr_core::TextBlock> {
    engine
        .recognize(&fixture(name), &Lang::new(lang).unwrap())
        .unwrap()
}

fn joined(blocks: &[tr_core::TextBlock]) -> String {
    blocks
        .iter()
        .map(|b| b.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn english_text_is_recognized_with_boxes_inside_the_image() {
    let mut ocr = engine();
    for (file, expected) in [
        ("en1.png", "Hello world, this is a test."),
        ("en2.png", "Where is the train station?"),
        ("en_sub.png", "I will not let you down."), // estilo subtítulo: claro sobre oscuro
    ] {
        let frame = fixture(file);
        let blocks = ocr.recognize(&frame, &Lang::new("en").unwrap()).unwrap();
        assert_eq!(joined(&blocks), expected, "{file}");
        for b in &blocks {
            assert!(b.confidence > 0.5, "{file}: confianza {}", b.confidence);
            assert!(b.bbox.width > 0 && b.bbox.height > 0);
            assert!(
                b.bbox.x + b.bbox.width <= frame.width + 1
                    && b.bbox.y + b.bbox.height <= frame.height + 1,
                "{file}: {:?}",
                b.bbox
            );
        }
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn japanese_text_is_recognized_with_the_same_models() {
    let mut ocr = engine();
    assert_eq!(
        joined(&recognize(&mut ocr, "ja1.png", "ja")),
        "こんにちは、世界"
    );
    assert_eq!(
        joined(&recognize(&mut ocr, "ja2.png", "ja")),
        "駅はどこですか？"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn an_image_without_text_gives_an_empty_list_not_an_error() {
    let mut ocr = engine();
    assert!(recognize(&mut ocr, "blank.png", "en").is_empty());
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn an_unsupported_language_is_refused_without_recognizing() {
    let mut ocr = engine();
    let error = ocr
        .recognize(&fixture("en1.png"), &Lang::new("ko").unwrap())
        .unwrap_err();
    assert!(
        matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
        "{error}"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn recognition_is_fast_enough_for_live_subtitles() {
    let mut ocr = engine();
    let frame = fixture("en1.png");
    let lang = Lang::new("en").unwrap();
    ocr.recognize(&frame, &lang).unwrap(); // calentamiento
    let mut times: Vec<Duration> = (0..5)
        .map(|_| {
            let t = Instant::now();
            ocr.recognize(&frame, &lang).unwrap();
            t.elapsed()
        })
        .collect();
    times.sort();
    // En el spike la mediana fue de ~50 ms; el margen cubre máquinas lentas y compilación debug.
    assert!(
        times[2] < Duration::from_millis(1500),
        "mediana {:?}",
        times[2]
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn a_screenshot_sized_frame_is_processed() {
    // Una región típica de subtítulos (1280x200) con la frase en el centro.
    let mut ocr = engine();
    let small = fixture("en1.png");
    let (w, h) = (1280u32, 200u32);
    let mut canvas = vec![255u8; (w * h * 4) as usize];
    for y in 0..small.height.min(h) {
        for x in 0..small.width.min(w) {
            let src = ((y * small.width + x) * 4) as usize;
            let dst = (((y + 60) % h * w + x + 300) * 4) as usize;
            canvas[dst..dst + 4].copy_from_slice(&small.rgba[src..src + 4]);
        }
    }
    let frame = Frame::new(w, h, canvas).unwrap();
    let blocks = ocr.recognize(&frame, &Lang::new("en").unwrap()).unwrap();
    assert_eq!(joined(&blocks), "Hello world, this is a test.");
    assert!(
        blocks[0].bbox.x >= 290,
        "la caja sigue la posición real: {:?}",
        blocks[0].bbox
    );
}
