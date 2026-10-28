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

use tr_adapters::perf::PerfConfig;
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

fn load_with(pair: &str, perf: &PerfConfig) -> OpusMt {
    let root = std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR");
    let (from, to) = pair.split_once('-').unwrap();
    OpusMt::load_with(
        &PathBuf::from(root).join(format!("mt-opus-{pair}")),
        &lang(from),
        &lang(to),
        perf,
    )
    .expect("cargar los modelos de traducción")
}

fn words(text: &str) -> std::collections::HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn beam_search_keeps_the_quality_of_the_reference_sentences() {
    // La calidad no baja: con 2 y 4 haces cada frase comparte al menos la mitad de sus palabras
    // con la salida voraz de referencia, y en conjunto al menos el 70 %.
    let greedy = load_with("en-es", &PerfConfig::default());
    let (en, es) = (lang("en"), lang("es"));
    for beam_size in [2, 4] {
        let beam = load_with(
            "en-es",
            &PerfConfig {
                beam_size,
                ..PerfConfig::default()
            },
        );
        let (mut shared, mut total) = (0usize, 0usize);
        for source in [
            "Hello, how are you?",
            "Where is the train station?",
            "I will not let you down.",
            "Thank you very much for your help.",
            "The meeting has been moved to tomorrow morning.",
        ] {
            let (reference, candidate) = (
                words(&greedy.translate(source, &en, &es).unwrap()),
                words(&beam.translate(source, &en, &es).unwrap()),
            );
            assert!(!candidate.is_empty(), "{source}");
            let common = reference.intersection(&candidate).count();
            assert!(
                common * 2 >= reference.len(),
                "{beam_size} haces: {source}: {common}/{}",
                reference.len()
            );
            shared += common;
            total += reference.len();
        }
        assert!(
            shared * 10 >= total * 7,
            "{beam_size} haces: {shared}/{total}"
        );
    }
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR) y la carpeta mt-opus-en-es-plain"]
fn the_decoder_without_cache_still_translates_the_same_sentences() {
    // El manifiesto entrega el decoder con caché. Para probar el respaldo sin caché hace falta
    // una carpeta `mt-opus-en-es-plain` dentro de TR_MODELS_DIR: los mismos archivos de
    // `mt-opus-en-es` (pueden ser enlaces) pero con `decoder.onnx` = `onnx/decoder_model_quantized.onnx`
    // de Xenova/opus-mt-en-es@4b002a4c7edd54a7ced58877258b87f7efd3f892
    // (sha256 2b45074cc819f1d901e40510d7bc0781d99327d16c7eca04518c4ee0c3d6ba10).
    let plain = PathBuf::from(std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR"))
        .join("mt-opus-en-es-plain");
    assert!(
        plain.join("decoder.onnx").is_file(),
        "falta {} (ver el comentario de este test)",
        plain.display()
    );
    let mt = OpusMt::load(&plain, &lang("en"), &lang("es")).unwrap();
    assert!(!mt.uses_kv_cache());
    assert_eq!(
        mt.translate("Where is the train station?", &lang("en"), &lang("es"))
            .unwrap(),
        "¿Dónde está la estación de tren?"
    );
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn the_decoder_delivered_by_the_manifest_uses_the_kv_cache() {
    // El modelo descargado con el manifiesto (decoder "merged" como `decoder.onnx`) activa la caché.
    assert!(load("en-es").uses_kv_cache());
}

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn explicit_thread_counts_and_low_memory_give_the_same_greedy_result() {
    for perf in [
        PerfConfig {
            intra_threads: 1,
            ..PerfConfig::default()
        },
        PerfConfig {
            low_memory: true,
            ..PerfConfig::default()
        },
    ] {
        let mt = load_with("en-es", &perf);
        assert_eq!(
            mt.translate("I will not let you down.", &lang("en"), &lang("es"))
                .unwrap(),
            "No te decepcionaré."
        );
    }
}
