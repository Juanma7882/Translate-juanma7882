//! Manifiesto de modelos: qué archivos componen cada modelo y qué modelos necesita cada idioma.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;
use tr_core::{CoreError, Lang, Result};

const EMBEDDED: &str = include_str!("../models.json");
const SUPPORTED_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FileSpec {
    /// Nombre local dentro de la carpeta del modelo.
    pub name: String,
    pub url: String,
    /// SHA-256 en hexadecimal minúscula.
    pub sha256: String,
    pub size: u64,
}

/// Para qué se usa un modelo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    Ocr,
    Stt,
    Translate,
}

impl ModelKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Ocr => "ocr",
            Self::Stt => "stt",
            Self::Translate => "translate",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: String,
    pub files: Vec<FileSpec>,
}

impl ModelSpec {
    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

#[derive(Deserialize)]
struct RawModel {
    files: Vec<FileSpec>,
}

#[derive(Deserialize)]
struct RawManifest {
    version: u32,
    models: BTreeMap<String, RawModel>,
    ocr: BTreeMap<String, String>,
    /// Reconocimiento de voz por idioma (opcional en manifiestos propios sin audio).
    #[serde(default)]
    stt: BTreeMap<String, String>,
    translate: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct Manifest {
    models: BTreeMap<String, ModelSpec>,
    ocr: BTreeMap<String, String>,
    stt: BTreeMap<String, String>,
    translate: BTreeMap<String, String>,
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Model(format!("invalid model manifest: {}", message.into()))
}

/// Subetiqueta principal del idioma (`es-MX` -> `es`).
fn primary(lang: &Lang) -> &str {
    lang.as_str().split('-').next().unwrap_or_default()
}

fn is_local_http(url: &str) -> bool {
    url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")
}

fn validate_file(model: &str, file: &FileSpec) -> Result<()> {
    let name = file.name.as_str();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err(invalid(format!(
            "model `{model}` has an unsafe file name `{name}`"
        )));
    }
    if file.sha256.len() != 64
        || !file
            .sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid(format!(
            "`{model}/{name}` needs a lowercase SHA-256 of 64 hex digits"
        )));
    }
    if !(file.url.starts_with("https://") || is_local_http(&file.url)) {
        return Err(invalid(format!("`{model}/{name}` must use https")));
    }
    if file.size == 0 {
        return Err(invalid(format!("`{model}/{name}` has no size")));
    }
    Ok(())
}

impl Manifest {
    /// Manifiesto incluido en el binario.
    pub fn embedded() -> &'static Manifest {
        static MANIFEST: OnceLock<Manifest> = OnceLock::new();
        MANIFEST.get_or_init(|| Manifest::parse(EMBEDDED).expect("the embedded manifest is valid"))
    }

    pub fn parse(json: &str) -> Result<Self> {
        let raw: RawManifest = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;
        if raw.version != SUPPORTED_VERSION {
            return Err(invalid(format!("unsupported version {}", raw.version)));
        }
        let mut models = BTreeMap::new();
        for (id, model) in raw.models {
            if model.files.is_empty() {
                return Err(invalid(format!("model `{id}` has no files")));
            }
            for file in &model.files {
                validate_file(&id, file)?;
            }
            models.insert(
                id.clone(),
                ModelSpec {
                    id,
                    files: model.files,
                },
            );
        }
        for (key, id) in raw.ocr.iter().chain(&raw.stt).chain(&raw.translate) {
            if !models.contains_key(id) {
                return Err(invalid(format!(
                    "`{key}` refers to the unknown model `{id}`"
                )));
            }
        }
        for key in raw.translate.keys() {
            let valid = key
                .split_once('-')
                .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty());
            if !valid {
                return Err(invalid(format!(
                    "translation pair `{key}` must look like `en-es`"
                )));
            }
        }
        Ok(Self {
            models,
            ocr: raw.ocr,
            stt: raw.stt,
            translate: raw.translate,
        })
    }

    pub fn model(&self, id: &str) -> Option<&ModelSpec> {
        self.models.get(id)
    }

    /// Todos los modelos del manifiesto, ordenados por identificador.
    pub fn models(&self) -> impl Iterator<Item = &ModelSpec> {
        self.models.values()
    }

    /// Para qué sirve el modelo `id`: tipo y claves (idiomas de OCR o voz, o pares `en-es`).
    pub fn roles_of(&self, id: &str) -> Vec<(ModelKind, String)> {
        let pick = |table: &BTreeMap<String, String>, kind: ModelKind| {
            table
                .iter()
                .filter(|(_, model)| model.as_str() == id)
                .map(|(key, _)| (kind, key.clone()))
                .collect::<Vec<_>>()
        };
        let mut roles = pick(&self.ocr, ModelKind::Ocr);
        roles.extend(pick(&self.stt, ModelKind::Stt));
        roles.extend(pick(&self.translate, ModelKind::Translate));
        roles
    }

    /// Modelo de OCR para el idioma de origen.
    pub fn ocr_model(&self, lang: &Lang) -> Result<&ModelSpec> {
        self.ocr
            .get(primary(lang))
            .and_then(|id| self.models.get(id))
            .ok_or_else(|| CoreError::InvalidArgument(format!("unsupported OCR language `{lang}`")))
    }

    /// Modelo de reconocimiento de voz para el idioma de origen.
    pub fn stt_model(&self, lang: &Lang) -> Result<&ModelSpec> {
        self.stt
            .get(primary(lang))
            .and_then(|id| self.models.get(id))
            .ok_or_else(|| {
                CoreError::InvalidArgument(format!("unsupported speech language `{lang}`"))
            })
    }

    /// Modelo de traducción para el par.
    pub fn translate_model(&self, from: &Lang, to: &Lang) -> Result<&ModelSpec> {
        let key = format!("{}-{}", primary(from), primary(to));
        self.translate
            .get(&key)
            .and_then(|id| self.models.get(id))
            .ok_or_else(|| {
                CoreError::InvalidArgument(format!(
                    "unsupported translation pair `{from}` -> `{to}`"
                ))
            })
    }

    /// Añade a `models` los de traducción `from` -> cada destino, sin repetidos. Sin destinos no
    /// añade ninguno: basta el reconocimiento del idioma de origen.
    fn with_translations<'a>(
        &'a self,
        mut models: Vec<&'a ModelSpec>,
        from: &Lang,
        targets: &[Lang],
    ) -> Result<Vec<&'a ModelSpec>> {
        for to in targets {
            let translation = self.translate_model(from, to)?;
            if !models.contains(&translation) {
                models.push(translation);
            }
        }
        Ok(models)
    }

    /// Modelos necesarios para reconocer texto en `from` y traducir `from` -> cada destino, sin
    /// repetidos. Con `targets` vacío, solo el OCR.
    pub fn required_for(&self, from: &Lang, targets: &[Lang]) -> Result<Vec<&ModelSpec>> {
        self.with_translations(vec![self.ocr_model(from)?], from, targets)
    }

    /// Modelos necesarios para transcribir voz en `from` y traducir `from` -> cada destino, sin
    /// repetidos. Con `targets` vacío, solo el reconocimiento de voz.
    pub fn required_for_audio(&self, from: &Lang, targets: &[Lang]) -> Result<Vec<&ModelSpec>> {
        self.with_translations(vec![self.stt_model(from)?], from, targets)
    }

    /// Modelos de texto y de audio juntos para los destinos, sin repetidos.
    pub fn required_for_all(&self, from: &Lang, targets: &[Lang]) -> Result<Vec<&ModelSpec>> {
        let mut models = self.required_for(from, targets)?;
        for spec in self.required_for_audio(from, targets)? {
            if !models.contains(&spec) {
                models.push(spec);
            }
        }
        Ok(models)
    }

    /// Idiomas que reconoce el modelo de OCR `model_id`, ordenados.
    pub fn ocr_languages_for(&self, model_id: &str) -> Vec<&str> {
        self.ocr
            .iter()
            .filter(|(_, id)| id.as_str() == model_id)
            .map(|(lang, _)| lang.as_str())
            .collect()
    }

    /// Idiomas con OCR disponible, ordenados.
    pub fn ocr_languages(&self) -> Vec<&str> {
        self.ocr.keys().map(String::as_str).collect()
    }

    /// Idiomas con reconocimiento de voz disponible, ordenados.
    pub fn stt_languages(&self) -> Vec<&str> {
        self.stt.keys().map(String::as_str).collect()
    }

    /// Pares de traducción disponibles (`origen`, `destino`), ordenados.
    pub fn translation_pairs(&self) -> Vec<(&str, &str)> {
        self.translate
            .keys()
            .filter_map(|k| k.split_once('-'))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    #[test]
    fn the_embedded_manifest_offers_the_additional_pairs_with_immutable_urls() {
        let manifest = Manifest::embedded();
        let pairs = manifest.translation_pairs();
        for pair in [
            ("en", "es"),
            ("es", "en"),
            ("en", "fr"),
            ("fr", "en"),
            ("en", "de"),
            ("de", "en"),
            ("en", "it"),
            ("it", "en"),
            ("es", "fr"),
            ("fr", "es"),
        ] {
            assert!(pairs.contains(&pair), "falta el par {pair:?}");
            let model = manifest
                .translate_model(&lang(pair.0), &lang(pair.1))
                .unwrap();
            assert_eq!(model.files.len(), 5, "{}", model.id);
            for file in &model.files {
                // Una revisión fija (40 hex) en la URL: el contenido no cambia por debajo.
                assert!(
                    file.url
                        .split('/')
                        .any(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())),
                    "{}: {}",
                    model.id,
                    file.url
                );
            }
        }
    }

    #[test]
    fn roles_describe_what_each_model_is_for() {
        let manifest = Manifest::embedded();
        assert_eq!(
            manifest.roles_of("mt-opus-en-fr"),
            [(ModelKind::Translate, "en-fr".to_owned())]
        );
        let ocr = manifest.roles_of("ocr-ppocrv6-small");
        assert!(ocr.iter().all(|(k, _)| *k == ModelKind::Ocr));
        assert!(ocr.iter().any(|(_, k)| k == "ja"));
        assert!(manifest.roles_of("nope").is_empty());
        assert_eq!(
            manifest.models().count(),
            manifest.models().collect::<Vec<_>>().len()
        );
        assert_eq!(ModelKind::Stt.name(), "stt");
    }

    fn manifest_json(file: &str) -> String {
        format!(
            r#"{{"version":1,"models":{{"m":{{"files":[{file}]}}}},"ocr":{{"en":"m"}},"translate":{{"en-es":"m"}}}}"#
        )
    }

    fn good_file() -> String {
        format!(
            r#"{{"name":"a.bin","url":"https://x.test/a","sha256":"{}","size":10}}"#,
            "ab".repeat(32)
        )
    }

    #[test]
    fn the_embedded_manifest_is_valid_and_complete() {
        let m = Manifest::embedded();
        assert!(m.ocr_languages().contains(&"en") && m.ocr_languages().contains(&"ja"));
        let pairs = m.translation_pairs();
        assert!(pairs.contains(&("en", "es")) && pairs.contains(&("es", "en")));
        assert_eq!(pairs.len(), 10);
        for model in ["ocr-ppocrv6-small", "mt-opus-en-es", "mt-opus-es-en"] {
            assert!(m.model(model).is_some(), "{model}");
        }
    }

    #[test]
    fn models_for_a_pair_are_listed_exactly() {
        let m = Manifest::embedded();
        let ids: Vec<_> = m
            .required_for(&lang("en"), &[lang("es")])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(ids, ["ocr-ppocrv6-small", "mt-opus-en-es"]);
        let spec = m.translate_model(&lang("en"), &lang("es")).unwrap();
        let names: Vec<_> = spec.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "encoder.onnx",
                "decoder.onnx",
                "source.spm",
                "vocab.json",
                "config.json"
            ]
        );
        assert!(spec.total_size() > 100_000_000);
    }

    #[test]
    fn without_targets_only_the_recognition_model_is_required() {
        let m = Manifest::embedded();
        let text: Vec<_> = m
            .required_for(&lang("en"), &[])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(text, ["ocr-ppocrv6-small"]);
        let audio: Vec<_> = m
            .required_for_audio(&lang("en"), &[])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(audio, ["stt-whisper-base"]);
    }

    #[test]
    fn two_targets_add_one_translation_model_each_without_repeats() {
        let m = Manifest::embedded();
        let ids: Vec<_> = m
            .required_for(&lang("en"), &[lang("es"), lang("fr"), lang("es")])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(ids, ["ocr-ppocrv6-small", "mt-opus-en-es", "mt-opus-en-fr"]);
    }

    #[test]
    fn one_unsupported_target_fails_the_whole_set() {
        let m = Manifest::embedded();
        assert!(matches!(
            m.required_for(&lang("de"), &[lang("en"), lang("es")]),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn the_languages_of_an_ocr_model_are_listed() {
        let m = Manifest::embedded();
        let langs = m.ocr_languages_for("ocr-ppocrv6-small");
        for expected in ["en", "es", "ja", "zh"] {
            assert!(langs.contains(&expected), "{langs:?}");
        }
        assert!(!langs.contains(&"ko"));
        assert!(m.ocr_languages_for("mt-opus-en-es").is_empty());
    }

    #[test]
    fn models_for_audio_are_the_speech_model_and_the_translation() {
        let m = Manifest::embedded();
        let ids: Vec<_> = m
            .required_for_audio(&lang("es"), &[lang("en")])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(ids, ["stt-whisper-base", "mt-opus-es-en"]);
        let all: Vec<_> = m
            .required_for_all(&lang("en"), &[lang("es")])
            .unwrap()
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(
            all,
            ["ocr-ppocrv6-small", "mt-opus-en-es", "stt-whisper-base"]
        );
        let spec = m.stt_model(&lang("en")).unwrap();
        let names: Vec<_> = spec.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "encoder.onnx",
                "decoder.onnx",
                "vocab.json",
                "added_tokens.json"
            ]
        );
        assert!(m.stt_languages().contains(&"ja"));
        assert!(
            m.model("stt-whisper-tiny").is_some(),
            "alternativa más ligera"
        );
    }

    #[test]
    fn speech_languages_without_a_model_are_reported() {
        let m = Manifest::embedded();
        for error in [
            m.stt_model(&lang("ko")).unwrap_err(),
            m.required_for_audio(&lang("ja"), &[lang("es")])
                .unwrap_err(),
        ] {
            assert!(
                matches!(&error, CoreError::InvalidArgument(msg) if msg.contains("unsupported")),
                "{error}"
            );
        }
    }

    #[test]
    fn a_manifest_without_speech_models_still_parses() {
        let m = Manifest::parse(&manifest_json(&good_file())).unwrap();
        assert!(m.stt_languages().is_empty());
        assert!(m.stt_model(&lang("en")).is_err());
    }

    #[test]
    fn regional_variants_use_the_primary_language() {
        let m = Manifest::embedded();
        assert!(m.ocr_model(&lang("es-MX")).is_ok());
        assert!(m.translate_model(&lang("en-US"), &lang("es-AR")).is_ok());
    }

    #[test]
    fn unsupported_languages_and_pairs_are_reported() {
        let m = Manifest::embedded();
        for error in [
            m.ocr_model(&lang("ko")).unwrap_err(),
            m.translate_model(&lang("en"), &lang("ru")).unwrap_err(),
            m.required_for(&lang("ja"), &[lang("es")]).unwrap_err(),
        ] {
            assert!(
                matches!(&error, CoreError::InvalidArgument(msg) if msg.contains("unsupported")),
                "{error}"
            );
        }
    }

    #[test]
    fn every_embedded_file_is_well_formed() {
        let m = Manifest::embedded();
        for id in [
            "ocr-ppocrv6-small",
            "mt-opus-en-es",
            "mt-opus-es-en",
            "stt-whisper-base",
            "stt-whisper-tiny",
            "mt-opus-en-fr",
            "mt-opus-fr-en",
            "mt-opus-en-de",
            "mt-opus-de-en",
            "mt-opus-en-it",
            "mt-opus-it-en",
            "mt-opus-es-fr",
            "mt-opus-fr-es",
        ] {
            for f in &m.model(id).unwrap().files {
                assert_eq!(f.sha256.len(), 64, "{id}/{}", f.name);
                assert!(f.url.starts_with("https://"), "{id}/{}", f.name);
                assert!(f.size > 0);
            }
        }
    }

    #[test]
    fn a_valid_custom_manifest_parses() {
        assert!(Manifest::parse(&manifest_json(&good_file())).is_ok());
    }

    #[test]
    fn invalid_manifests_are_rejected() {
        let cases = [
            ("not json".to_owned(), "invalid model manifest"),
            (
                manifest_json(&good_file()).replace(r#""version":1"#, r#""version":2"#),
                "unsupported version",
            ),
            (
                manifest_json(&good_file().replace("ab", "AB")),
                "lowercase SHA-256",
            ),
            (
                manifest_json(&good_file().replace(&"ab".repeat(32), "abc")),
                "lowercase SHA-256",
            ),
            (
                manifest_json(&good_file().replace("https://", "http://example.com/")),
                "must use https",
            ),
            (
                manifest_json(&good_file().replace("a.bin", "../evil")),
                "unsafe file name",
            ),
            (
                manifest_json(&good_file().replace("a.bin", "dir/a.bin")),
                "unsafe file name",
            ),
            (
                manifest_json(&good_file().replace("\"size\":10", "\"size\":0")),
                "no size",
            ),
            (manifest_json(""), "no files"),
            (
                manifest_json(&good_file()).replace(r#""en":"m""#, r#""en":"zzz""#),
                "unknown model",
            ),
            (
                manifest_json(&good_file()).replace("en-es", "enes"),
                "must look like",
            ),
        ];
        for (json, expected) in cases {
            let error = Manifest::parse(&json).unwrap_err().to_string();
            assert!(
                error.contains(expected),
                "esperaba `{expected}`, obtuve `{error}`"
            );
        }
    }

    #[test]
    fn local_http_is_allowed_for_tests() {
        let json =
            manifest_json(&good_file().replace("https://x.test/a", "http://127.0.0.1:1234/a"));
        assert!(Manifest::parse(&json).is_ok());
    }
}
