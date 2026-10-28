//! Mediciones de rendimiento del motor completo (Hito 5A): arranque, latencia de un frame con
//! texto hasta su traducción, CPU en reposo y RAM. Solo imprime NÚMEROS; método y presupuestos
//! en `docs/perf/hito-5.md`. Necesita modelos y un servidor X:
//!
//! `TR_MODELS_DIR=<carpeta> scripts/with-xvfb.sh cargo run --release -p tr-engine --example perf_engine`
//!
//! Variables opcionales: `TR_BEAMS`, `TR_THREADS` (0 = automático), `TR_IDLE_SECS` (por defecto 10).

#![allow(clippy::print_stdout)] // única excepción: imprime cifras, nunca contenido.

#[cfg(all(
    target_os = "linux",
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus"
))]
mod run {
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use tr_core::testing::RecordingSink;
    use tr_core::{Event, Lang, Region};
    use tr_engine::{Engine, EngineConfig, EngineKind, PerformanceConfig};
    use xcb::x;

    const WIN_X: i16 = 80;
    const WIN_Y: i16 = 40;

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    fn env_num<T: std::str::FromStr>(name: &str) -> Option<T> {
        std::env::var(name).ok()?.parse().ok()
    }

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

    /// Tiempo de CPU del proceso (usuario + sistema) en segundos.
    fn cpu_seconds() -> f64 {
        let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
        let after_name = stat.rsplit(") ").next().unwrap_or_default();
        let fields: Vec<&str> = after_name.split_whitespace().collect();
        let ticks = |i: usize| {
            fields
                .get(i)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0)
        };
        // utime y stime son los campos 14 y 15 (índices 11 y 12 tras el nombre).
        (ticks(11) + ticks(12)) / 100.0
    }

    fn show_image(fixture: &str) -> (xcb::Connection, u32, u32) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tr-adapters/tests/fixtures")
            .join(fixture);
        let rgba = image::open(path).expect("abrir el fixture").to_rgba8();
        let (width, height) = (rgba.width(), rgba.height());
        let (conn, screen_num) = xcb::Connection::connect(None).expect("conectar con X");
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
        conn.flush().unwrap();
        std::thread::sleep(Duration::from_millis(400));
        (conn, width, height)
    }

    fn engine(interval_ms: u64) -> (Engine, RecordingSink) {
        let sink = RecordingSink::new();
        let models =
            PathBuf::from(std::env::var_os("TR_MODELS_DIR").expect("define TR_MODELS_DIR"));
        let config = EngineConfig {
            engines: EngineKind::Real,
            models_dir: Some(models),
            timing: tr_core::runner::LoopTiming {
                interval: Duration::from_millis(interval_ms),
                idle_interval: Duration::from_millis(interval_ms.max(1000)),
            },
            performance: PerformanceConfig {
                intra_threads: env_num("TR_THREADS"),
                beam_width: env_num("TR_BEAMS"),
            },
            ..EngineConfig::default()
        };
        (Engine::new(config, Arc::new(sink.clone())), sink)
    }

    fn translations(sink: &RecordingSink) -> usize {
        sink.events()
            .iter()
            .filter(|e| matches!(e, Event::Translation { .. }))
            .count()
    }

    pub fn main() {
        let idle_secs: u64 = env_num("TR_IDLE_SECS").unwrap_or(10);

        // 1) Arranque, CPU en reposo (región sin texto) y RAM.
        {
            let (mut engine, _sink) = engine(200);
            let region = Region::new(0, 0, 300, 100, 0).unwrap();
            let started = Instant::now();
            engine
                .start_region(region, lang("en"), vec![lang("es")])
                .unwrap();
            println!(
                "arranque (cargar modelos): {:.0} ms",
                started.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "RAM tras arrancar: rss={:.0} MiB pico={:.0} MiB",
                proc_mib("VmRSS:"),
                proc_mib("VmHWM:")
            );
            std::thread::sleep(Duration::from_secs(2)); // deja pasar la primera captura y el OCR
            let (c0, t0) = (cpu_seconds(), Instant::now());
            std::thread::sleep(Duration::from_secs(idle_secs));
            let cpu = (cpu_seconds() - c0) / t0.elapsed().as_secs_f64() * 100.0;
            println!(
                "CPU en reposo (pantalla sin cambios, {idle_secs} s): {cpu:.1} % de un nucleo"
            );
            engine.stop();
        }

        // 2) Latencia: frame con texto -> traducción (incluye captura, 2 frames estables, OCR y traducción).
        let (_window, width, height) = show_image("en1.png");
        let mut samples = Vec::new();
        for _ in 0..5 {
            let (mut engine, sink) = engine(100);
            let region = Region::new(i32::from(WIN_X), i32::from(WIN_Y), width, height, 0).unwrap();
            engine
                .start_region(region, lang("en"), vec![lang("es")])
                .unwrap();
            let started = Instant::now();
            while translations(&sink) == 0 && started.elapsed() < Duration::from_secs(30) {
                std::thread::sleep(Duration::from_millis(2));
            }
            samples.push(started.elapsed());
            if samples.len() == 1 {
                let (c0, t0) = (cpu_seconds(), Instant::now());
                std::thread::sleep(Duration::from_secs(3));
                let cpu = (cpu_seconds() - c0) / t0.elapsed().as_secs_f64() * 100.0;
                println!("CPU con texto estable ya traducido: {cpu:.1} % de un nucleo");
            }
            engine.stop();
        }
        samples.sort();
        println!(
            "latencia frame con texto -> traduccion (intervalo 100 ms): mediana {:.0} ms (min {:.0}, max {:.0})",
            samples[samples.len() / 2].as_secs_f64() * 1000.0,
            samples[0].as_secs_f64() * 1000.0,
            samples[samples.len() - 1].as_secs_f64() * 1000.0
        );
        println!(
            "RAM final: rss={:.0} MiB pico={:.0} MiB",
            proc_mib("VmRSS:"),
            proc_mib("VmHWM:")
        );
    }
}

#[cfg(all(
    target_os = "linux",
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus"
))]
fn main() {
    run::main();
}

#[cfg(not(all(
    target_os = "linux",
    feature = "screen-xcap",
    feature = "ocr-paddle",
    feature = "translate-opus"
)))]
fn main() {
    println!("este ejemplo necesita Linux y los motores de pantalla, OCR y traduccion");
}
