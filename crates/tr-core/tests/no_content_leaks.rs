//! Garantías de "nada a disco ni a logs" para el contenido procesado.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tr_core::cache::TranslationCache;
use tr_core::region::{RegionConfig, RegionProcessor};
use tr_core::testing::{FakeClock, FakeOcr, FakeTranslator, RecordingSink};
use tr_core::{AudioChunk, CoreError, Event, Frame, Lang};

const SECRET: &str = "SECRET-CONTENT-7f3a91";

fn listing(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    entries
}

#[test]
fn a_full_run_creates_no_files() {
    let cwd = std::env::current_dir().unwrap();
    let before = listing(&cwd);

    let (ocr, translator, sink) = (FakeOcr::new(), FakeTranslator::new(), RecordingSink::new());
    ocr.push_text(SECRET);
    let mut processor = RegionProcessor::new(
        RegionConfig::new(Lang::new("en").unwrap(), Lang::new("es").unwrap()),
        Box::new(ocr),
        Arc::new(translator),
        Arc::new(TranslationCache::default()),
        Arc::new(sink.clone()),
        Arc::new(FakeClock::new()),
    );
    for _ in 0..5 {
        processor.process(&Frame::solid(16, 16, 10));
    }

    assert!(
        sink.events()
            .iter()
            .any(|e| matches!(e, Event::Translation { original, .. } if original == SECRET)),
        "el contenido sí llega al sumidero de eventos (por diseño)"
    );
    assert_eq!(listing(&cwd), before, "no debe aparecer ningún archivo");
}

#[test]
fn debug_output_of_captured_data_hides_the_content() {
    let frame = Frame::new(1, 1, vec![171, 205, 239, 255]).unwrap();
    let chunk = AudioChunk::new(vec![0.314159; 8], Duration::ZERO);
    let rendered = format!("{frame:?} {chunk:?}");
    assert!(!rendered.contains("171") && !rendered.contains("0.314159"));
}

#[test]
fn error_events_carry_the_engine_message_not_the_processed_text() {
    let ocr = FakeOcr::new();
    ocr.push_error(CoreError::Ocr("engine unavailable".into()));
    let sink = RecordingSink::new();
    let mut processor = RegionProcessor::new(
        RegionConfig::new(Lang::new("en").unwrap(), Lang::new("es").unwrap()),
        Box::new(ocr),
        Arc::new(FakeTranslator::new()),
        Arc::new(TranslationCache::default()),
        Arc::new(sink.clone()),
        Arc::new(FakeClock::new()),
    );
    processor.process(&Frame::solid(16, 16, 10));
    let rendered = format!("{:?}", sink.events());
    assert!(!rendered.contains(SECRET));
}

/// Recorre `crates/<crate>/src` y devuelve el código de producción (hasta `#[cfg(test)]`).
fn production_sources(crate_dir: &str) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(crate_dir)
        .join("src");
    let mut files = Vec::new();
    walk(&root, &mut files);
    files
        .into_iter()
        .map(|path| {
            let text = fs::read_to_string(&path).unwrap();
            let production = text.split("#[cfg(test)]").next().unwrap().to_owned();
            (path, production)
        })
        .collect()
}

#[test]
fn production_code_has_no_disk_or_print_apis() {
    let forbidden = [
        "println!",
        "eprintln!",
        "print!(",
        "eprint!(",
        "dbg!(",
        "File::create",
        "fs::write",
        "OpenOptions",
        "fs::copy",
    ];
    let mut offenses = Vec::new();
    for crate_dir in ["tr-core", "tr-engine"] {
        for (path, code) in production_sources(crate_dir) {
            for needle in forbidden {
                // Los comentarios pueden mencionar estas APIs.
                let used = code
                    .lines()
                    .any(|l| !l.trim_start().starts_with("//") && l.contains(needle));
                if used {
                    offenses.push(format!("{}: {needle}", path.display()));
                }
            }
        }
    }
    assert!(offenses.is_empty(), "APIs prohibidas: {offenses:#?}");
}
