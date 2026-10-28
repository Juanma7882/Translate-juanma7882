//! Descarga los modelos de un par de idiomas:
//! `cargo run -p tr-models --example fetch -- <carpeta> <origen> <destino> [text|audio|all]`.
//!
//! Herramienta de desarrollo: sirve para preparar modelos reales para las pruebas
//! (`TR_MODELS_DIR`) y para comprobar el manifiesto contra internet.

// Es un ejemplo de línea de comandos: imprimir progreso es su función (no es código de producción).
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::sync::atomic::AtomicBool;

use tr_core::Lang;
use tr_models::{Manifest, ModelManager};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (dir, from, to, scope) = match args.as_slice() {
        [dir, from, to] => (dir, from, to, "text"),
        [dir, from, to, scope] => (dir, from, to, scope.as_str()),
        _ => {
            eprintln!(
                "uso: fetch <carpeta> <origen> <destino> [text|audio|all]   (por ejemplo: fetch ./models en es audio)"
            );
            std::process::exit(2);
        }
    };
    let (from, to) = (
        Lang::new(from).expect("idioma de origen"),
        Lang::new(to).expect("idioma de destino"),
    );
    let manifest = Manifest::embedded();
    let specs = match scope {
        "text" => manifest.required_for(&from, std::slice::from_ref(&to)),
        "audio" => manifest.required_for_audio(&from, std::slice::from_ref(&to)),
        "all" => manifest.required_for_all(&from, std::slice::from_ref(&to)),
        other => {
            eprintln!("ámbito desconocido `{other}` (usa text, audio o all)");
            std::process::exit(2);
        }
    }
    .unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });
    let manager = ModelManager::new(dir);
    let cancel = AtomicBool::new(false);
    for spec in specs {
        println!("{} ({:.1} MB)", spec.id, spec.total_size() as f64 / 1e6);
        let mut last_pct = u64::MAX;
        let result = manager.ensure(spec, &cancel, &mut |p| {
            let pct = p.downloaded * 100 / p.total.max(1);
            if pct != last_pct && pct % 10 == 0 {
                last_pct = pct;
                println!("  {pct:>3} %");
            }
        });
        match result {
            Ok(()) => println!("  listo: {:?}", manager.state(spec)),
            Err(e) => {
                eprintln!("  error: {e}");
                std::process::exit(1);
            }
        }
    }
}
