//! Motores reales: captura de pantalla, OCR y traducción.
//!
//! Cada motor va tras su feature de Cargo; si falta en este build se informa cuál, sin afectar
//! a los demás. Antes de construir nada se comprueba que los modelos del par estén listos.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tr_adapters::perf::PerfConfig;
use tr_core::{
    AudioCapture, CoreError, Lang, OcrEngine, Result, ScreenCapture, SpeechToText, Translator,
};
use tr_models::{Manifest, ModelManager};

use crate::models::resolve_dir;

pub(crate) struct RegionParts {
    pub screen: Box<dyn ScreenCapture>,
    pub ocr: Box<dyn OcrEngine>,
    /// Un traductor por destino, en el orden de los destinos.
    pub translators: Vec<Arc<dyn Translator>>,
}

pub(crate) struct AudioParts {
    pub audio: Box<dyn AudioCapture>,
    pub stt: Box<dyn SpeechToText>,
    /// Un traductor por destino, en el orden de los destinos.
    pub translators: Vec<Arc<dyn Translator>>,
}

/// Espera a un hilo de carga de modelo; un pánico se informa como error de modelo.
fn join_load<T>(handle: std::thread::ScopedJoinHandle<'_, Result<T>>) -> Result<T> {
    handle
        .join()
        .unwrap_or_else(|_| Err(CoreError::Model("model loading panicked".into())))
}

/// Carga un traductor por destino, todos a la vez: el arranque dura lo que el más lento.
fn load_translators(
    manager: &ModelManager,
    manifest: &Manifest,
    from: &Lang,
    targets: &[Lang],
    perf: &PerfConfig,
) -> Result<Vec<Arc<dyn Translator>>> {
    let specs = targets
        .iter()
        .map(|to| manifest.translate_model(from, to))
        .collect::<Result<Vec<_>>>()?;
    std::thread::scope(|scope| {
        let handles: Vec<_> = specs
            .iter()
            .zip(targets)
            .map(|(spec, to)| {
                let dir = manager.model_dir(spec);
                scope.spawn(move || translator(&dir, from, to, perf))
            })
            .collect();
        handles.into_iter().map(join_load).collect()
    })
}

fn not_available(engine: &str) -> CoreError {
    CoreError::InvalidArgument(format!(
        "the {engine} engine is not available in this build"
    ))
}

#[cfg(feature = "screen-xcap")]
fn screen() -> Result<Box<dyn ScreenCapture>> {
    Ok(Box::new(tr_adapters::screen::XcapScreen::new()))
}
#[cfg(not(feature = "screen-xcap"))]
fn screen() -> Result<Box<dyn ScreenCapture>> {
    Err(not_available("screen capture"))
}

#[cfg(feature = "ocr-paddle")]
fn ocr(model_dir: &Path, languages: &[&str], perf: &PerfConfig) -> Result<Box<dyn OcrEngine>> {
    Ok(Box::new(tr_adapters::ocr::PaddleOcr::load_with(
        model_dir, languages, perf,
    )?))
}
#[cfg(not(feature = "ocr-paddle"))]
fn ocr(_model_dir: &Path, _languages: &[&str], _perf: &PerfConfig) -> Result<Box<dyn OcrEngine>> {
    Err(not_available("OCR"))
}

#[cfg(feature = "translate-opus")]
fn translator(
    model_dir: &Path,
    from: &Lang,
    to: &Lang,
    perf: &PerfConfig,
) -> Result<Arc<dyn Translator>> {
    Ok(Arc::new(tr_adapters::translate::OpusMt::load_with(
        model_dir, from, to, perf,
    )?))
}
#[cfg(not(feature = "translate-opus"))]
fn translator(
    _model_dir: &Path,
    _from: &Lang,
    _to: &Lang,
    _perf: &PerfConfig,
) -> Result<Arc<dyn Translator>> {
    Err(not_available("translation"))
}

#[cfg(feature = "audio-loopback")]
pub(crate) fn audio() -> Result<Box<dyn AudioCapture>> {
    Ok(Box::new(tr_adapters::audio::PlatformAudioCapture::new()))
}
#[cfg(not(feature = "audio-loopback"))]
pub(crate) fn audio() -> Result<Box<dyn AudioCapture>> {
    Err(not_available("system audio capture"))
}

/// Lista de aplicaciones con audio de la plataforma (o una que declara "no disponible").
pub(crate) fn source_lister() -> Box<dyn tr_core::AudioSourceLister> {
    Box::new(tr_adapters::audio::PlatformSourceLister::default())
}

#[cfg(feature = "stt-whisper")]
fn stt(model_dir: &Path, from: &Lang, perf: &PerfConfig) -> Result<Box<dyn SpeechToText>> {
    Ok(Box::new(tr_adapters::stt::WhisperStt::load_with(
        model_dir, from, perf,
    )?))
}
#[cfg(not(feature = "stt-whisper"))]
fn stt(_model_dir: &Path, _from: &Lang, _perf: &PerfConfig) -> Result<Box<dyn SpeechToText>> {
    Err(not_available("speech recognition"))
}

/// Falla si algún motor no se compiló en este build, sin tocar modelos ni pantalla. El de
/// traducción solo se exige cuando hay destinos.
fn ensure_compiled(needs_translation: bool) -> Result<()> {
    if !cfg!(feature = "screen-xcap") {
        return Err(not_available("screen capture"));
    }
    if !cfg!(feature = "ocr-paddle") {
        return Err(not_available("OCR"));
    }
    if needs_translation && !cfg!(feature = "translate-opus") {
        return Err(not_available("translation"));
    }
    Ok(())
}

/// Construye los motores reales de región para `from` -> cada destino de `targets` (con
/// `targets` vacío no se carga ningún traductor).
///
/// Orden: motores compilados, idiomas del manifiesto, modelos listos y, solo entonces, carga de
/// modelos. Si faltan modelos no se llega a crear la captura de pantalla.
pub(crate) fn region_parts(
    models_dir: Option<PathBuf>,
    manifest: &Manifest,
    from: &Lang,
    targets: &[Lang],
    perf: &PerfConfig,
) -> Result<RegionParts> {
    ensure_compiled(!targets.is_empty())?;
    let required = manifest.required_for(from, targets)?;
    let manager = ModelManager::new(resolve_dir(models_dir)?);
    let missing = manager.missing(&required);
    if !missing.is_empty() {
        return Err(CoreError::Model(format!(
            "missing models: {}. Download them before starting",
            missing.join(", ")
        )));
    }

    let ocr_spec = manifest.ocr_model(from)?;
    let languages = manifest.ocr_languages_for(&ocr_spec.id);
    // El OCR y los traductores se cargan a la vez: el arranque dura lo que el más lento.
    let (ocr, translators) = std::thread::scope(|scope| {
        let ocr = scope.spawn(|| ocr(&manager.model_dir(ocr_spec), &languages, perf));
        let translators = load_translators(&manager, manifest, from, targets, perf);
        (join_load(ocr), translators)
    });
    Ok(RegionParts {
        ocr: ocr?,
        translators: translators?,
        screen: screen()?,
    })
}

fn ensure_audio_compiled(needs_translation: bool) -> Result<()> {
    if !cfg!(feature = "audio-loopback") {
        return Err(not_available("system audio capture"));
    }
    if !cfg!(feature = "stt-whisper") {
        return Err(not_available("speech recognition"));
    }
    if needs_translation && !cfg!(feature = "translate-opus") {
        return Err(not_available("translation"));
    }
    Ok(())
}

/// Comprobación previa del fallback: motores compilados y modelos de texto **y** de audio listos.
/// Si faltan, el error los lista juntos (sin repetidos) para que el usuario los descargue de una vez.
pub(crate) fn ensure_fallback_ready(
    models_dir: Option<PathBuf>,
    manifest: &Manifest,
    from: &Lang,
    targets: &[Lang],
) -> Result<()> {
    ensure_compiled(!targets.is_empty())?;
    ensure_audio_compiled(!targets.is_empty())?;
    let required = manifest.required_for_all(from, targets)?;
    let manager = ModelManager::new(resolve_dir(models_dir)?);
    let missing = manager.missing(&required);
    if missing.is_empty() {
        return Ok(());
    }
    Err(CoreError::Model(format!(
        "missing models: {}. Download them before starting",
        missing.join(", ")
    )))
}

/// Construye los motores reales de audio para `from` -> cada destino, con el mismo orden de comprobaciones
/// que [`region_parts`]: la captura del sistema solo se crea cuando los modelos ya cargaron.
///
/// Con `shared_translators` (el fallback) no se vuelven a cargar los modelos de traducción.
pub(crate) fn audio_parts(
    models_dir: Option<PathBuf>,
    manifest: &Manifest,
    from: &Lang,
    targets: &[Lang],
    shared_translators: Option<Vec<Arc<dyn Translator>>>,
    perf: &PerfConfig,
) -> Result<AudioParts> {
    ensure_audio_compiled(shared_translators.is_none() && !targets.is_empty())?;
    let required = manifest.required_for_audio(from, targets)?;
    let manager = ModelManager::new(resolve_dir(models_dir)?);
    let missing = manager.missing(&required);
    if !missing.is_empty() {
        return Err(CoreError::Model(format!(
            "missing models: {}. Download them before starting",
            missing.join(", ")
        )));
    }
    let stt_spec = manifest.stt_model(from)?;
    // El reconocimiento de voz y los traductores (si no vienen compartidos) se cargan a la vez.
    let (stt, translators) = std::thread::scope(|scope| {
        let stt = scope.spawn(|| stt(&manager.model_dir(stt_spec), from, perf));
        let translators = match shared_translators {
            Some(shared) => Ok(shared),
            None => load_translators(&manager, manifest, from, targets, perf),
        };
        (join_load(stt), translators)
    });
    Ok(AudioParts {
        stt: stt?,
        translators: translators?,
        audio: audio()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    fn empty_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tr-engine-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Los dos primeros tests suponen que todos los motores están compilados: sin alguno, el error de
    // "motor no disponible" tiene prioridad sobre el de modelos (ver `ensure_compiled`).
    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "translate-opus"
    ))]
    #[test]
    fn missing_models_are_listed_by_id_and_nothing_is_built() {
        let Err(error) = region_parts(
            Some(empty_dir("missing")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        assert!(
            message.contains("ocr-ppocrv6-small") && message.contains("mt-opus-en-es"),
            "{message}"
        );
    }

    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "translate-opus"
    ))]
    #[test]
    fn without_targets_only_the_ocr_model_is_required() {
        let Err(error) = region_parts(
            Some(empty_dir("no-targets")),
            Manifest::embedded(),
            &lang("en"),
            &[],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        assert!(
            message.contains("ocr-ppocrv6-small") && !message.contains("mt-opus"),
            "{message}"
        );
    }

    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "translate-opus"
    ))]
    #[test]
    fn two_targets_list_the_models_of_both() {
        let Err(error) = region_parts(
            Some(empty_dir("two-targets")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es"), lang("fr")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        let message = error.to_string();
        assert!(
            message.contains("mt-opus-en-es") && message.contains("mt-opus-en-fr"),
            "{message}"
        );
    }

    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "translate-opus"
    ))]
    #[test]
    fn unsupported_languages_fail_before_looking_at_the_models_folder() {
        // Un par sin modelos de OCR conocidos falla por idioma antes de mirar la carpeta.
        let Err(error) = region_parts(
            Some(empty_dir("lang")),
            Manifest::embedded(),
            &lang("ko"),
            &[lang("es")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{error}"
        );
        let Err(error) = region_parts(
            Some(empty_dir("pair")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("ru")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{error}"
        );
    }

    #[cfg(not(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "translate-opus"
    )))]
    #[test]
    fn an_engine_left_out_of_the_build_is_reported() {
        let Err(error) = region_parts(
            Some(empty_dir("no-engine")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        assert!(
            error.to_string().contains("is not available in this build"),
            "{error}"
        );
    }

    #[cfg(all(
        feature = "stt-whisper",
        feature = "audio-loopback",
        feature = "translate-opus"
    ))]
    #[test]
    fn audio_lists_only_speech_and_translation_models_when_missing() {
        let Err(error) = audio_parts(
            Some(empty_dir("audio-missing")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es")],
            None,
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        assert!(
            message.contains("stt-whisper-base") && message.contains("mt-opus-en-es"),
            "{message}"
        );
        assert!(!message.contains("ocr-"), "{message}");
    }

    #[cfg(all(
        feature = "stt-whisper",
        feature = "audio-loopback",
        feature = "translate-opus"
    ))]
    #[test]
    fn audio_rejects_unsupported_languages_before_the_models_folder() {
        for (from, to) in [("ko", "es"), ("en", "ru")] {
            let Err(error) = audio_parts(
                Some(empty_dir("audio-lang")),
                Manifest::embedded(),
                &lang(from),
                &[lang(to)],
                None,
                &PerfConfig::default(),
            ) else {
                panic!("debe fallar")
            };
            assert!(
                matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
                "{from}->{to}: {error}"
            );
        }
    }

    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "stt-whisper",
        feature = "audio-loopback",
        feature = "translate-opus"
    ))]
    #[test]
    fn fallback_lists_text_and_audio_models_together_without_duplicates() {
        let Err(error) = ensure_fallback_ready(
            Some(empty_dir("fallback-missing")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es")],
        ) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        for id in ["ocr-ppocrv6-small", "stt-whisper-base", "mt-opus-en-es"] {
            assert_eq!(
                message.matches(id).count(),
                1,
                "{id} una sola vez: {message}"
            );
        }
    }

    #[cfg(all(
        feature = "screen-xcap",
        feature = "ocr-paddle",
        feature = "stt-whisper",
        feature = "audio-loopback",
        feature = "translate-opus"
    ))]
    #[test]
    fn fallback_rejects_unsupported_languages_before_the_models_folder() {
        let Err(error) = ensure_fallback_ready(
            Some(empty_dir("fallback-lang")),
            Manifest::embedded(),
            &lang("ko"),
            &[lang("es")],
        ) else {
            panic!("debe fallar")
        };
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported")),
            "{error}"
        );
    }

    #[cfg(all(feature = "screen-xcap", not(feature = "ocr-paddle")))]
    #[test]
    fn the_report_names_the_missing_engine() {
        let Err(error) = region_parts(
            Some(empty_dir("no-ocr")),
            Manifest::embedded(),
            &lang("en"),
            &[lang("es")],
            &PerfConfig::default(),
        ) else {
            panic!("debe fallar")
        };
        assert!(
            error.to_string().contains("OCR engine is not available"),
            "{error}"
        );
    }
}
