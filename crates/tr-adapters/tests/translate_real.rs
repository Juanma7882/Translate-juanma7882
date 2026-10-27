//! Traducción con los modelos reales (Opus-MT en ONNX int8).
//!
//! Necesita los modelos descargados: `cargo run -p tr-models --example fetch -- <carpeta> en es`
//! (y `es en`), y luego
//! `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-adapters --test translate_real -- --ignored`.
//! La decodificación voraz es determinista, por eso se comparan frases exactas.

#![cfg(feature = "translate-opus")]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tr_adapters::translate::OpusMt;
use tr_core::{CoreError, Lang, Translator};

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn load(pair: &str) -> OpusMt {
    let root = std::env::var_os("TR_MODELS_DIR")
        .expect("define TR_MODELS_DIR con la carpeta de modelos (ver la cabecera de este archivo)");
    let (from, to) = pair.split_once('-').unwrap();
    OpusMt::load(
        &PathBuf::from(root).join(format!("mt-opus-{pair}")),
        &lang(from),
        &lang(to),
    )
    .expect("cargar los modelos de traducción")
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn english_to_spanish() {
    let mt = load("en-es");
    let (en, es) = (lang("en"), lang("es"));
    for (source, expected) in [
        ("Hello, how are you?", "Hola, ¿cómo estás?"),
        (
            "Where is the train station?",
            "¿Dónde está la estación de tren?",
        ),
        ("I will not let you down.", "No te decepcionaré."),
        (
            "Thank you very much for your help.",
            "Muchas gracias por su ayuda.",
        ),
        (
            "The meeting has been moved to tomorrow morning.",
            "La reunión se ha trasladado a mañana por la mañana.",
        ),
    ] {
        assert_eq!(
            mt.translate(source, &en, &es).unwrap(),
            expected,
            "{source}"
        );
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn spanish_to_english() {
    let mt = load("es-en");
    let (es, en) = (lang("es"), lang("en"));
    for (source, expected) in [
        (
            "¿Dónde está la estación de tren?",
            "Where's the train station?",
        ),
        (
            "Muchas gracias por tu ayuda.",
            "Thank you so much for your help.",
        ),
        ("No te voy a decepcionar.", "I'm not gonna let you down."),
        (
            "La reunión se ha cambiado para mañana por la mañana.",
            "The meeting has been changed by tomorrow morning.",
        ),
        (
            "Me gustaría reservar una mesa para dos.",
            "I'd like to set up a table for two.",
        ),
    ] {
        assert_eq!(
            mt.translate(source, &es, &en).unwrap(),
            expected,
            "{source}"
        );
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn empty_text_gives_empty_text_and_never_invents_anything() {
    // Con una entrada vacía el modelo, ejecutado, devuelve texto inventado (se comprobó en el spike).
    let mt = load("en-es");
    for text in ["", "   ", "\n"] {
        assert_eq!(mt.translate(text, &lang("en"), &lang("es")).unwrap(), "");
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn another_pair_is_refused_without_running_the_model() {
    let mt = load("en-es");
    let error = mt.translate("hello", &lang("es"), &lang("en")).unwrap_err();
    assert!(
        matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
        "{error}"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn punctuation_digits_and_unknown_characters_do_not_break_it() {
    let mt = load("en-es");
    for text in [
        "!!!",
        "12345",
        "☃ ☃ ☃",
        "ok",
        "A",
        "Mr. Smith's 3rd visit @ 10:30 - $5.99?",
    ] {
        let result = mt.translate(text, &lang("en"), &lang("es"));
        assert!(result.is_ok(), "{text:?}: {result:?}");
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn a_very_long_input_finishes_in_bounded_time() {
    let mt = load("en-es");
    let long = "This is a very long sentence that keeps going on and on without any real purpose, "
        .repeat(40);
    assert!(long.len() > 3000);
    let started = Instant::now();
    let result = mt.translate(long.trim(), &lang("en"), &lang("es")).unwrap();
    // En el spike 492 caracteres tardaron ~5 s sin límites; con la entrada y la salida acotadas
    // el peor caso es una fracción de eso aunque el texto tenga miles de caracteres.
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "tardó {:?}",
        started.elapsed()
    );
    assert!(!result.is_empty());
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn two_threads_get_their_own_translations() {
    let mt = Arc::new(load("en-es"));
    let sentences = [
        ("Hello, how are you?", "Hola, ¿cómo estás?"),
        ("I will not let you down.", "No te decepcionaré."),
    ];
    let workers: Vec<_> = sentences
        .into_iter()
        .map(|(source, expected)| {
            let mt = Arc::clone(&mt);
            std::thread::spawn(move || {
                for _ in 0..4 {
                    assert_eq!(
                        mt.translate(source, &lang("en"), &lang("es")).unwrap(),
                        expected
                    );
                }
            })
        })
        .collect();
    for worker in workers {
        worker
            .join()
            .expect("cada hilo recibe la traducción de su propio texto");
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn a_subtitle_translates_fast_enough_for_live_use() {
    let mt = load("en-es");
    let (en, es) = (lang("en"), lang("es"));
    mt.translate("warm up", &en, &es).unwrap();
    let mut times: Vec<Duration> = (0..5)
        .map(|_| {
            let t = Instant::now();
            mt.translate("Where is the train station?", &en, &es)
                .unwrap();
            t.elapsed()
        })
        .collect();
    times.sort();
    // En el spike la mediana fue de ~265 ms.
    assert!(
        times[2] < Duration::from_millis(2000),
        "mediana {:?}",
        times[2]
    );
}
