//! Cada par de idiomas del manifiesto traduce una frase real con su modelo Opus-MT.
//!
//! Necesita los modelos descargados en `TR_MODELS_DIR` (una carpeta por modelo, `mt-opus-<par>`);
//! se obtienen con `cargo run -p tr-models --example fetch -- <carpeta> <origen> <destino>`.
//! `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-engine --test real_pairs -- --ignored`.
//! Se exige que haya traducción no vacía, distinta de la entrada, y que contenga una palabra
//! esperada del idioma de destino (la decodificación voraz es determinista).

#![cfg(feature = "translate-opus")]

use std::path::PathBuf;

use tr_adapters::translate::OpusMt;
use tr_core::{Lang, Translator};
use tr_models::Manifest;

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

/// (par, frase de origen, fragmento esperado en minúsculas).
const PHRASES: &[(&str, &str, &str)] = &[
    ("en-fr", "Where is the train station?", "gare"),
    ("fr-en", "Où est la gare ?", "station"),
    ("en-de", "Where is the train station?", "bahnhof"),
    ("de-en", "Wo ist der Bahnhof?", "station"),
    ("en-it", "Where is the train station?", "stazione"),
    ("it-en", "Dov'è la stazione dei treni?", "station"),
    ("fr-es", "Où est la gare ?", "estación"),
    ("es-fr", "¿Dónde está la estación de tren?", "gare"),
];

#[test]
#[ignore = "necesita modelos reales (TR_MODELS_DIR)"]
fn every_additional_pair_translates_a_real_sentence() {
    let root = PathBuf::from(
        std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR (ver la cabecera)"),
    );
    let manifest = Manifest::embedded();
    for (pair, source, expected) in PHRASES {
        let (from, to) = pair.split_once('-').unwrap();
        let (from, to) = (lang(from), lang(to));
        let model = manifest.translate_model(&from, &to).unwrap();
        let mt = OpusMt::load(&root.join(&model.id), &from, &to)
            .unwrap_or_else(|e| panic!("{pair}: {e}"));
        let out = mt.translate(source, &from, &to).unwrap();
        assert!(!out.trim().is_empty(), "{pair}: salida vacía");
        assert_ne!(&out, source, "{pair}: sin traducir");
        assert!(
            out.to_lowercase().contains(expected),
            "{pair}: `{out}` no contiene `{expected}`"
        );
    }
}
