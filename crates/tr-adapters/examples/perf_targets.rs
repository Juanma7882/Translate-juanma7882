//! Latencia de traducir a uno o a dos destinos (change `idiomas-y-subtitulos-multiples`). Solo
//! imprime NÚMEROS (milisegundos): ni textos ni contenido salen a consola ni a disco.
//!
//! `TR_MODELS_DIR=<carpeta> cargo run --release -p tr-adapters --example perf_targets -- <one|serial|parallel>`
//!
//! - `one`: un destino (`en -> es`).
//! - `serial`: dos destinos (`en -> es`, `en -> fr`) uno tras otro.
//! - `parallel`: los mismos dos destinos a la vez (`tr_core::translate::translate_all`).
//!
//! Variables (opcionales): `TR_THREADS` (hilos de ONNX por sesión, 0 = automático), `TR_BEAMS`, `TR_REPS`.
//! Cada escenario se mide en su propio proceso para poder comparar también la memoria.

#![allow(clippy::print_stdout)] // única excepción: imprime cifras, nunca contenido.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tr_adapters::perf::PerfConfig;
use tr_adapters::translate::OpusMt;
use tr_core::cache::TranslationCache;
use tr_core::translate::{Target, translate_all};
use tr_core::{Lang, Translator};

/// Frases de prueba fijas del repositorio, de distinta longitud (nunca contenido del usuario).
const PHRASES: [&str; 4] = [
    "Where is the station?",
    "The meeting has been moved to tomorrow morning because of the weather.",
    "If you are going to the city center, remember to take an umbrella with you, because it is going to rain all afternoon.",
    "After a long discussion about the budget, the committee finally agreed to postpone the decision until next month, when all the members will be able to attend and review the new proposal in detail together.",
];

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

fn env_num<T: std::str::FromStr>(name: &str) -> Option<T> {
    std::env::var(name).ok()?.parse().ok()
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn median(mut times: Vec<Duration>) -> f64 {
    times.sort();
    ms(times[times.len() / 2])
}

fn load(
    models: &std::path::Path,
    folder: &str,
    from: &Lang,
    to: &Lang,
    config: &PerfConfig,
) -> Arc<dyn Translator> {
    let started = Instant::now();
    let mt = OpusMt::load_with(&models.join(folder), from, to, config).unwrap();
    println!("carga {folder}: {:.0} ms", ms(started.elapsed()));
    Arc::new(mt)
}

fn main() {
    let scenario = std::env::args().nth(1).unwrap_or_default();
    let models = PathBuf::from(std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR"));
    let reps: usize = env_num("TR_REPS").unwrap_or(7);
    let mut config = PerfConfig::default();
    if let Some(v) = env_num("TR_THREADS") {
        config.intra_threads = v;
    }
    if let Some(v) = env_num("TR_BEAMS") {
        config.beam_size = v;
    }
    let (en, es, fr) = (lang("en"), lang("es"), lang("fr"));
    println!(
        "escenario: {scenario}, hilos por sesión: {}, haces: {}, repeticiones: {reps}",
        config.threads_capped(2),
        config.beams()
    );

    let two = matches!(scenario.as_str(), "serial" | "parallel");
    let mt_es = load(&models, "mt-opus-en-es", &en, &es, &config);
    let mt_fr = two.then(|| load(&models, "mt-opus-en-fr", &en, &fr, &config));

    // Calentamiento: la primera inferencia de cada sesión es más lenta.
    mt_es.translate("warm up", &en, &es).unwrap();
    if let Some(mt) = &mt_fr {
        mt.translate("warm up", &en, &fr).unwrap();
    }

    let targets: Vec<Target> = match &mt_fr {
        Some(fr_mt) => vec![
            Target::new(es.clone(), mt_es.clone()),
            Target::new(fr.clone(), fr_mt.clone()),
        ],
        None => vec![Target::new(es.clone(), mt_es.clone())],
    };

    let mut medians = Vec::new();
    for text in PHRASES {
        let times: Vec<Duration> = (0..reps)
            .map(|_| {
                let started = Instant::now();
                match scenario.as_str() {
                    "one" => {
                        mt_es.translate(text, &en, &es).unwrap();
                    }
                    "serial" => {
                        mt_es.translate(text, &en, &es).unwrap();
                        mt_fr.as_ref().unwrap().translate(text, &en, &fr).unwrap();
                    }
                    "parallel" => {
                        // Caché nueva en cada repetición: se mide la traducción, no un acierto.
                        let outcome =
                            translate_all(&targets, &en, text, &TranslationCache::default());
                        assert_eq!(outcome.translations.len(), 2);
                    }
                    other => panic!("escenario desconocido `{other}` (usa one, serial o parallel)"),
                }
                started.elapsed()
            })
            .collect();
        let m = median(times);
        println!("{scenario} {:>3} car.: mediana {m:>6.0} ms", text.len());
        medians.push(m);
    }
    let mean = medians.iter().sum::<f64>() / medians.len() as f64;
    println!("{scenario} RESUMEN: latencia media de medianas {mean:.0} ms");
}
