//! Servicio de modelos contra un servidor HTTP local (sin internet).

use std::sync::Arc;
use std::time::Duration;

use tr_core::testing::RecordingSink;
use tr_core::{CoreError, Event, Lang};
use tr_engine::{Manifest, ModelState, Models};
use tr_models::sha256_hex;
use tr_models::testing::{Route, TestServer};

fn lang(code: &str) -> Lang {
    Lang::new(code).unwrap()
}

struct Served {
    server: TestServer,
    manifest: Arc<Manifest>,
}

/// Dos modelos: `o` (OCR, 1 archivo) y `t` (traducción, 2 archivos), servidos por HTTP local.
fn serve(slow: bool) -> Served {
    let big: Vec<u8> = (0..150_000u32).map(|i| (i % 251) as u8).collect();
    let files = [
        ("o", "a.bin", big.clone()),
        ("t", "b.bin", b"model-b".to_vec()),
        ("t", "c.bin", b"model-c-data".to_vec()),
    ];
    let route = |body: &Vec<u8>| {
        if slow {
            Route::Slow {
                body: body.clone(),
                chunk: 10_000,
                delay: Duration::from_millis(30),
            }
        } else {
            Route::Body(body.clone())
        }
    };
    let routes: Vec<(String, Route)> = files
        .iter()
        .map(|(_, name, body)| (format!("/{name}"), route(body)))
        .collect();
    let server = TestServer::start(
        routes
            .iter()
            .map(|(p, r)| (p.as_str(), r.clone()))
            .collect(),
    );

    let entry = |name: &str, body: &[u8]| {
        format!(
            r#"{{"name":"{name}","url":"{}","sha256":"{}","size":{}}}"#,
            server.url(&format!("/{name}")),
            sha256_hex(body),
            body.len()
        )
    };
    let json = format!(
        r#"{{"version":1,
            "models":{{"o":{{"files":[{}]}},"t":{{"files":[{},{}]}}}},
            "ocr":{{"en":"o"}},"translate":{{"en-es":"t"}}}}"#,
        entry("a.bin", &files[0].2),
        entry("b.bin", &files[1].2),
        entry("c.bin", &files[2].2)
    );
    Served {
        server,
        manifest: Arc::new(Manifest::parse(&json).unwrap()),
    }
}

fn models(served: &Served, tag: &str) -> (Models, RecordingSink) {
    let dir = std::env::temp_dir().join(format!("tr-models-svc-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let sink = RecordingSink::new();
    let models =
        Models::with_manifest(Some(dir), served.manifest.clone(), Arc::new(sink.clone())).unwrap();
    (models, sink)
}

fn progress(sink: &RecordingSink) -> Vec<(String, u64, u64)> {
    sink.events()
        .into_iter()
        .filter_map(|e| match e {
            Event::ModelProgress {
                model,
                downloaded,
                total,
            } => Some((model, downloaded, total.unwrap())),
            _ => None,
        })
        .collect()
}

#[test]
fn the_catalog_lists_the_languages_and_pairs_of_the_manifest() {
    let served = serve(false);
    let (models, _sink) = models(&served, "catalog");
    let catalog = models.catalog();
    assert_eq!(catalog.ocr_languages, ["en"]);
    assert_eq!(catalog.pairs, [("en".to_owned(), "es".to_owned())]);
}

#[test]
fn status_lists_each_required_model_with_its_size() {
    let served = serve(false);
    let (models, _sink) = models(&served, "status");
    let status = models.status(&lang("en"), &lang("es")).unwrap();
    let summary: Vec<_> = status
        .iter()
        .map(|s| (s.id.as_str(), s.state, s.size))
        .collect();
    assert_eq!(
        summary,
        [
            ("o", ModelState::Missing, 150_000),
            ("t", ModelState::Missing, 19)
        ]
    );
}

#[test]
fn download_reports_growing_progress_per_model_and_leaves_everything_ready() {
    let served = serve(false);
    let (models, sink) = models(&served, "download");
    models.download(&lang("en"), &lang("es")).unwrap();

    let events = progress(&sink);
    for (id, total) in [("o", 150_000u64), ("t", 19)] {
        let of_model: Vec<_> = events.iter().filter(|(m, ..)| m == id).collect();
        assert!(!of_model.is_empty(), "{id} sin progreso");
        assert!(of_model.iter().all(|(_, _, t)| *t == total));
        assert!(
            of_model.windows(2).all(|w| w[0].1 <= w[1].1),
            "{id}: el progreso no retrocede"
        );
        assert_eq!(
            of_model.last().unwrap().1,
            total,
            "{id}: termina en el total"
        );
    }
    let status = models.status(&lang("en"), &lang("es")).unwrap();
    assert!(status.iter().all(|s| s.state == ModelState::Ready));
}

#[test]
fn downloading_again_touches_neither_the_network_nor_the_event_stream() {
    let served = serve(false);
    let (models, sink) = models(&served, "again");
    models.download(&lang("en"), &lang("es")).unwrap();
    let (hits, events) = (served.server.total_hits(), sink.len());
    models.download(&lang("en"), &lang("es")).unwrap();
    assert_eq!(served.server.total_hits(), hits);
    assert_eq!(sink.len(), events);
}

#[test]
fn unsupported_pairs_fail_with_a_descriptive_error() {
    let served = serve(false);
    let (models, sink) = models(&served, "unsupported");
    for result in [
        models.status(&lang("en"), &lang("fr")).map(|_| ()),
        models.download(&lang("ko"), &lang("es")),
    ] {
        let error = result.unwrap_err();
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{error}"
        );
    }
    assert!(sink.is_empty());
}

#[test]
fn a_failing_server_is_reported_and_leaves_the_model_missing() {
    let served = serve(false);
    let (models, _sink) = {
        // Manifiesto apuntando a una ruta que no existe: 404.
        let mut json =
            String::from(r#"{"version":1,"models":{"o":{"files":[{"name":"x.bin","url":""#);
        json.push_str(&served.server.url("/nope"));
        json.push_str(&format!(
            r#"","sha256":"{}","size":4}}]}}}},"ocr":{{"en":"o"}},"translate":{{"en-es":"o"}}}}"#,
            sha256_hex(b"abcd")
        ));
        let sink = RecordingSink::new();
        let dir = std::env::temp_dir().join(format!("tr-models-svc-404-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (
            Models::with_manifest(
                Some(dir),
                Arc::new(Manifest::parse(&json).unwrap()),
                Arc::new(sink.clone()),
            )
            .unwrap(),
            sink,
        )
    };
    let error = models.download(&lang("en"), &lang("es")).unwrap_err();
    assert!(matches!(error, CoreError::Model(_)), "{error}");
    assert_eq!(
        models.status(&lang("en"), &lang("es")).unwrap()[0].state,
        ModelState::Missing
    );
}

#[test]
fn cancelling_stops_the_download_and_leaves_nothing_valid() {
    let served = serve(true);
    let (models, sink) = models(&served, "cancel");
    let worker = {
        let models = models.clone();
        std::thread::spawn(move || models.download(&lang("en"), &lang("es")))
    };
    assert!(sink.wait_until(Duration::from_secs(5), |e| e.iter().any(
        |ev| matches!(ev, Event::ModelProgress { downloaded, .. } if *downloaded > 0)
    )));
    models.cancel();
    let error = worker.join().unwrap().unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");

    let count = sink.len();
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(sink.len(), count, "tras cancelar no llegan más eventos");
    let status = models.status(&lang("en"), &lang("es")).unwrap();
    assert!(
        status.iter().any(|s| s.state == ModelState::Missing),
        "quedó incompleto"
    );

    // Se puede reintentar: la señal de cancelación se reinicia.
    models.download(&lang("en"), &lang("es")).unwrap();
    assert!(
        models
            .status(&lang("en"), &lang("es"))
            .unwrap()
            .iter()
            .all(|s| s.state == ModelState::Ready)
    );
}
