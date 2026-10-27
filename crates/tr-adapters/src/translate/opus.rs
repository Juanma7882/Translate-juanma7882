//! Traductor Opus-MT (Marian) en ONNX int8: encoder una vez y decoder sin caché, decodificación
//! voraz acotada. Los modelos se leen de una carpeta; nada se escribe y no hay red.

use std::path::Path;
use std::sync::Mutex;

use ort::session::Session;
use ort::value::Tensor;
use tr_core::{CoreError, Lang, Result, Translator};

use super::marian::MarianTokenizer;

/// Archivos que debe tener la carpeta del modelo de un par.
pub const MODEL_FILES: [&str; 5] = [
    "encoder.onnx",
    "decoder.onnx",
    "source.spm",
    "vocab.json",
    "config.json",
];

/// Piezas de entrada como máximo (la terminación incluida): acota el coste de textos largos.
const MAX_INPUT_TOKENS: usize = 128;
/// Piezas generadas como máximo, pase lo que pase.
const MAX_OUTPUT_TOKENS: usize = 160;

fn translation_error(message: impl Into<String>) -> CoreError {
    CoreError::Translation(message.into())
}

fn primary(lang: &Lang) -> &str {
    lang.as_str().split('-').next().unwrap_or_default()
}

/// Piezas a generar como máximo para una entrada de `input_tokens` piezas.
fn output_limit(input_tokens: usize) -> usize {
    (input_tokens * 2 + 10).min(MAX_OUTPUT_TOKENS)
}

/// Id de mayor puntuación, ignorando `blocked` (el id de arranque del decoder, que nunca se
/// genera) y tratando NaN como la peor puntuación. En empate gana el menor id.
fn pick_next(logits: &[f32], blocked: i64) -> Option<usize> {
    logits
        .iter()
        .enumerate()
        .filter(|&(id, score)| id as i64 != blocked && !score.is_nan())
        .fold(
            None,
            |best: Option<(usize, f32)>, (id, &score)| match best {
                Some((_, top)) if top >= score => best,
                _ => Some((id, score)),
            },
        )
        .map(|(id, _)| id)
}

struct Sessions {
    encoder: Session,
    decoder: Session,
}

pub struct OpusMt {
    tokenizer: MarianTokenizer,
    sessions: Mutex<Sessions>,
    from: String,
    to: String,
}

fn ort_session(path: &Path) -> Result<Session> {
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get().min(4));
    let build = || -> ort::Result<Session> {
        let mut builder = Session::builder()?.with_intra_threads(threads)?;
        builder.commit_from_file(path)
    };
    build().map_err(|e| CoreError::Model(format!("could not load `{}`: {e}", path.display())))
}

impl OpusMt {
    /// Carga los modelos de `model_dir`, que traducen `from` -> `to`.
    pub fn load(model_dir: &Path, from: &Lang, to: &Lang) -> Result<Self> {
        let missing: Vec<&str> = MODEL_FILES
            .iter()
            .copied()
            .filter(|name| !model_dir.join(name).is_file())
            .collect();
        if !missing.is_empty() {
            return Err(CoreError::Model(format!(
                "the translation model is incomplete; missing: {}",
                missing.join(", ")
            )));
        }
        Ok(Self {
            tokenizer: MarianTokenizer::load(model_dir)?,
            sessions: Mutex::new(Sessions {
                encoder: ort_session(&model_dir.join("encoder.onnx"))?,
                decoder: ort_session(&model_dir.join("decoder.onnx"))?,
            }),
            from: primary(from).to_owned(),
            to: primary(to).to_owned(),
        })
    }

    fn run(&self, text: &str) -> Result<String> {
        let ids = self.tokenizer.encode(text, MAX_INPUT_TOKENS);
        let n = ids.len();
        let mask = vec![1i64; n];

        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fail = |what: &str, e: ort::Error| translation_error(format!("{what} failed: {e}"));

        let encoded = sessions
            .encoder
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(([1usize, n], ids)).map_err(|e| fail("encoding", e))?,
                "attention_mask" => Tensor::from_array(([1usize, n], mask.clone())).map_err(|e| fail("encoding", e))?,
            ])
            .map_err(|e| fail("encoding", e))?;
        let (shape, data) = encoded["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .map_err(|e| fail("encoding", e))?;
        let shape: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        let hidden = data.to_vec();
        drop(encoded);

        let start = self.tokenizer.decoder_start_id;
        let mut generated = vec![start];
        for _ in 0..output_limit(n) {
            let steps = generated.len();
            let outputs = sessions
                .decoder
                .run(ort::inputs![
                    "input_ids" => Tensor::from_array(([1usize, steps], generated.clone())).map_err(|e| fail("decoding", e))?,
                    "encoder_attention_mask" => Tensor::from_array(([1usize, n], mask.clone())).map_err(|e| fail("decoding", e))?,
                    "encoder_hidden_states" => Tensor::from_array((shape.clone(), hidden.clone())).map_err(|e| fail("decoding", e))?,
                ])
                .map_err(|e| fail("decoding", e))?;
            let (logits_shape, logits) = outputs["logits"]
                .try_extract_tensor::<f32>()
                .map_err(|e| fail("decoding", e))?;
            let vocab = *logits_shape
                .get(2)
                .ok_or_else(|| translation_error("unexpected logits shape"))?
                as usize;
            let last = logits
                .get((steps - 1) * vocab..steps * vocab)
                .ok_or_else(|| translation_error("unexpected logits size"))?;
            let next = pick_next(last, start)
                .ok_or_else(|| translation_error("the model produced no valid token"))?
                as i64;
            if next == self.tokenizer.eos_id() {
                break;
            }
            generated.push(next);
        }
        Ok(self.tokenizer.decode(&generated[1..]))
    }
}

/// Qué hacer con una petición antes de tocar el modelo.
#[derive(Debug, PartialEq, Eq)]
enum Precheck {
    /// Entrada vacía: el resultado es vacío. Con ella el modelo inventa texto, así que no se ejecuta.
    Empty,
    Translate,
}

/// Valida que la petición sea del par que cubre el modelo (`loaded`) y decide si hace falta ejecutarlo.
fn precheck(loaded: (&str, &str), text: &str, from: &Lang, to: &Lang) -> Result<Precheck> {
    if (primary(from), primary(to)) != loaded {
        return Err(CoreError::InvalidArgument(format!(
            "unsupported translation pair `{from}` -> `{to}` (this model translates `{}` -> `{}`)",
            loaded.0, loaded.1
        )));
    }
    Ok(if text.trim().is_empty() {
        Precheck::Empty
    } else {
        Precheck::Translate
    })
}

impl Translator for OpusMt {
    fn translate(&self, text: &str, from: &Lang, to: &Lang) -> Result<String> {
        match precheck((&self.from, &self.to), text, from, to)? {
            Precheck::Empty => Ok(String::new()),
            Precheck::Translate => self.run(text),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_limit_grows_with_the_input_but_is_capped() {
        assert_eq!(output_limit(1), 12);
        assert_eq!(output_limit(20), 50);
        assert_eq!(output_limit(MAX_INPUT_TOKENS), MAX_OUTPUT_TOKENS);
        assert_eq!(output_limit(10_000), MAX_OUTPUT_TOKENS);
    }

    #[test]
    fn the_best_scoring_token_is_chosen() {
        assert_eq!(pick_next(&[0.1, 0.9, 0.5], -1), Some(1));
        assert_eq!(
            pick_next(&[-5.0, -2.0, -9.0], -1),
            Some(1),
            "también con todo negativo"
        );
    }

    #[test]
    fn the_blocked_token_is_never_chosen_even_if_it_scores_highest() {
        assert_eq!(pick_next(&[0.1, 9.0, 0.5], 1), Some(2));
        assert_eq!(pick_next(&[9.0], 0), None, "nada que elegir");
    }

    #[test]
    fn ties_pick_the_smallest_id_and_nan_is_ignored() {
        assert_eq!(pick_next(&[1.0, 1.0, 1.0], -1), Some(0));
        assert_eq!(pick_next(&[f32::NAN, 0.5, f32::NAN, 0.4], -1), Some(1));
        assert_eq!(pick_next(&[f32::NAN, f32::NAN], -1), None);
        assert_eq!(pick_next(&[], -1), None);
    }

    #[test]
    fn infinities_do_not_break_the_choice() {
        assert_eq!(
            pick_next(&[f32::NEG_INFINITY, 0.0, f32::INFINITY], -1),
            Some(2)
        );
        assert_eq!(
            pick_next(&[f32::NEG_INFINITY, f32::NEG_INFINITY], -1),
            Some(0)
        );
    }

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    #[test]
    fn requests_for_the_loaded_pair_proceed() {
        let loaded = ("en", "es");
        assert_eq!(
            precheck(loaded, "hello", &lang("en"), &lang("es")).unwrap(),
            Precheck::Translate
        );
        assert_eq!(
            precheck(loaded, "hello", &lang("en-US"), &lang("es-MX")).unwrap(),
            Precheck::Translate
        );
    }

    #[test]
    fn empty_or_blank_text_never_reaches_the_model() {
        for text in ["", "   ", "\n\t "] {
            assert_eq!(
                precheck(("en", "es"), text, &lang("en"), &lang("es")).unwrap(),
                Precheck::Empty,
                "{text:?}"
            );
        }
    }

    #[test]
    fn another_pair_is_refused_even_for_empty_text() {
        for (from, to) in [("es", "en"), ("en", "fr"), ("fr", "es")] {
            let error = precheck(("en", "es"), "hello", &lang(from), &lang(to)).unwrap_err();
            assert!(
                matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported translation pair")),
                "{error}"
            );
        }
        assert!(
            precheck(("en", "es"), "", &lang("es"), &lang("en")).is_err(),
            "el par se valida primero"
        );
    }

    #[test]
    fn loading_without_models_names_the_missing_files() {
        let dir = std::env::temp_dir().join(format!("tr-mt-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (en, es) = (Lang::new("en").unwrap(), Lang::new("es").unwrap());
        let Err(error) = OpusMt::load(&dir, &en, &es) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        for name in MODEL_FILES {
            assert!(message.contains(name), "{message}");
        }
    }

    #[test]
    fn a_missing_folder_is_a_model_error() {
        let (en, es) = (Lang::new("en").unwrap(), Lang::new("es").unwrap());
        let Err(error) = OpusMt::load(Path::new("/definitely/not/here"), &en, &es) else {
            panic!("debe fallar")
        };
        assert!(matches!(error, CoreError::Model(_)));
    }
}
