//! Traductor Opus-MT (Marian) en ONNX int8: encoder una vez y decoder con caché de claves/valores
//! (export "merged") o, si el modelo no la trae, sin caché; búsqueda por haces acotada o voraz.
//! Los modelos se leen de una carpeta; nada se escribe y no hay red.

use std::borrow::Cow;
use std::path::Path;
use std::sync::Mutex;

use ort::session::{OutputSelector, RunOptions, Session, SessionInputValue};
use ort::value::{DynValue, Tensor};
use tr_core::{CoreError, Lang, Result, Translator};

use super::beam::{self, Decode, Search};
use super::marian::MarianTokenizer;
use crate::perf::PerfConfig;

/// Archivos que debe tener la carpeta del modelo de un par.
pub const MODEL_FILES: [&str; 5] = [
    "encoder.onnx",
    "decoder.onnx",
    "source.spm",
    "vocab.json",
    "config.json",
];

/// Decoder opcional con caché de claves/valores (export "merged"). Si está, se prefiere a
/// `decoder.onnx`. Transitorio: cuando el manifiesto entregue el "merged" como `decoder.onnx`
/// este archivo deja de hacer falta (el tipo de decoder se detecta por sus entradas).
pub const CACHED_DECODER_FILE: &str = "decoder_merged.onnx";

/// Piezas de entrada como máximo (la terminación incluida): acota el coste de textos largos.
const MAX_INPUT_TOKENS: usize = 128;
/// Hilos automáticos de la traducción: con más no se gana latencia (medido en el ADR 0006).
const MAX_AUTO_THREADS: usize = 2;
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

/// Cómo se alimenta el decoder.
enum Kind {
    /// Sin caché: cada paso recibe la secuencia completa.
    Plain,
    /// Con caché de claves/valores: cada paso recibe solo el último token.
    Cached {
        /// Entradas `past_key_values.*`, en orden.
        past: Vec<String>,
        /// Salidas `present.*` correspondientes.
        present: Vec<String>,
        heads: usize,
        head_dim: usize,
    },
}

impl Kind {
    fn detect(decoder: &Session) -> Self {
        let inputs = decoder.inputs();
        let past: Vec<String> = inputs
            .iter()
            .map(|i| i.name().to_owned())
            .filter(|n| n.starts_with("past_key_values."))
            .collect();
        if past.is_empty() || !inputs.iter().any(|i| i.name() == "use_cache_branch") {
            return Self::Plain;
        }
        let dim = |axis: usize| {
            inputs
                .iter()
                .find(|i| i.name() == past[0])
                .and_then(|i| i.dtype().tensor_shape())
                .and_then(|s| s.get(axis).copied())
                .filter(|&d| d > 0)
                .unwrap_or(1) as usize
        };
        Self::Cached {
            present: past
                .iter()
                .map(|n| n.replacen("past_key_values.", "present.", 1))
                .collect(),
            heads: dim(1),
            head_dim: dim(3),
            past,
        }
    }
}

struct Sessions {
    encoder: Session,
    decoder: Session,
}

pub struct OpusMt {
    tokenizer: MarianTokenizer,
    sessions: Mutex<Sessions>,
    kind: Kind,
    beams: usize,
    from: String,
    to: String,
}

impl OpusMt {
    /// Carga los modelos de `model_dir`, que traducen `from` -> `to`, con el rendimiento por
    /// defecto ([`PerfConfig::default`]).
    pub fn load(model_dir: &Path, from: &Lang, to: &Lang) -> Result<Self> {
        Self::load_with(model_dir, from, to, &PerfConfig::default())
    }

    /// Como [`Self::load`] con hilos y haces de `perf`. El tokenizador y las dos sesiones se
    /// cargan en paralelo.
    pub fn load_with(model_dir: &Path, from: &Lang, to: &Lang, perf: &PerfConfig) -> Result<Self> {
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
        let decoder_path = if model_dir.join(CACHED_DECODER_FILE).is_file() {
            model_dir.join(CACHED_DECODER_FILE)
        } else {
            model_dir.join("decoder.onnx")
        };
        let (threads, arena) = (perf.threads_capped(MAX_AUTO_THREADS), !perf.low_memory);
        let (tokenizer, encoder, decoder) = std::thread::scope(|scope| {
            let encoder = scope
                .spawn(|| crate::perf::session(&model_dir.join("encoder.onnx"), threads, arena));
            let decoder = scope.spawn(|| crate::perf::session(&decoder_path, threads, arena));
            let tokenizer = MarianTokenizer::load(model_dir);
            let joined = |handle: std::thread::ScopedJoinHandle<'_, Result<Session>>| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err(CoreError::Model("model loading panicked".into())))
            };
            (tokenizer, joined(encoder), joined(decoder))
        });
        let decoder = decoder?;
        Ok(Self {
            kind: Kind::detect(&decoder),
            tokenizer: tokenizer?,
            sessions: Mutex::new(Sessions {
                encoder: encoder?,
                decoder,
            }),
            beams: perf.beams(),
            from: primary(from).to_owned(),
            to: primary(to).to_owned(),
        })
    }

    /// `true` si el decoder usa caché de claves/valores.
    pub fn uses_kv_cache(&self) -> bool {
        matches!(self.kind, Kind::Cached { .. })
    }

    fn run(&self, text: &str) -> Result<String> {
        let ids = self.tokenizer.encode(text, MAX_INPUT_TOKENS);
        let n = ids.len();
        let k = self.beams;

        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fail = |what: &str, e: ort::Error| translation_error(format!("{what} failed: {e}"));

        let encoded = sessions
            .encoder
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(([1usize, n], ids)).map_err(|e| fail("encoding", e))?,
                "attention_mask" => Tensor::from_array(([1usize, n], vec![1i64; n])).map_err(|e| fail("encoding", e))?,
            ])
            .map_err(|e| fail("encoding", e))?;
        let (shape, data) = encoded["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .map_err(|e| fail("encoding", e))?;
        let width = shape.get(2).copied().unwrap_or(0) as usize;
        if width == 0 || data.len() != n * width {
            return Err(translation_error("unexpected encoder output shape"));
        }
        // Un lote de `k` filas idénticas: una por haz.
        let hidden = Tensor::from_array(([k, n, width], data.repeat(k)))
            .map_err(|e| fail("decoding", e))?
            .into_dyn();
        drop(encoded);
        let mask = Tensor::from_array(([k, n], vec![1i64; k * n]))
            .map_err(|e| fail("decoding", e))?
            .into_dyn();

        let mut decode = DecoderRun {
            decoder: &mut sessions.decoder,
            kind: &self.kind,
            hidden,
            mask,
            beams: k,
            past: Vec::new(),
        };
        let generated = beam::search(
            &Search {
                beams: k,
                max_len: output_limit(n),
                start: self.tokenizer.decoder_start_id,
                eos: self.tokenizer.eos_id(),
            },
            &mut decode,
        )?;
        Ok(self.tokenizer.decode(&generated))
    }
}

/// Estado del decoder durante una traducción.
struct DecoderRun<'a> {
    decoder: &'a mut Session,
    kind: &'a Kind,
    /// Salida del encoder repetida por haz: `[haces, n, d]`.
    hidden: DynValue,
    /// Máscara de atención del encoder: `[haces, n]`.
    mask: DynValue,
    beams: usize,
    /// Caché de claves/valores (vacía hasta el primer paso).
    past: Vec<DynValue>,
}

fn decode_error(e: ort::Error) -> CoreError {
    translation_error(format!("decoding failed: {e}"))
}

fn tensor_i64(shape: [usize; 2], data: Vec<i64>) -> Result<DynValue> {
    Ok(Tensor::from_array((shape, data))
        .map_err(decode_error)?
        .into_dyn())
}

/// Última fila de logits de cada haz, concatenadas: de `[haces, filas, vocab]` a `[haces, vocab]`.
fn last_rows(
    shape: &[i64],
    logits: &[f32],
    beams: usize,
    expected_rows: Option<usize>,
) -> Result<(Vec<f32>, usize)> {
    let vocab = shape.get(2).copied().unwrap_or(0) as usize;
    let rows = shape.get(1).copied().unwrap_or(0) as usize;
    if vocab == 0
        || rows == 0
        || expected_rows.is_some_and(|r| r != rows)
        || logits.len() != beams * rows * vocab
    {
        return Err(translation_error("unexpected logits shape"));
    }
    let mut last = Vec::with_capacity(beams * vocab);
    for beam in 0..beams {
        let end = (beam + 1) * rows * vocab;
        last.extend_from_slice(&logits[end - vocab..end]);
    }
    Ok((last, vocab))
}

impl DecoderRun<'_> {
    fn step_plain(&mut self, hyps: &[Vec<i64>]) -> Result<(Vec<f32>, usize)> {
        let len = hyps[0].len();
        let ids = tensor_i64([self.beams, len], hyps.iter().flatten().copied().collect())?;
        let options = RunOptions::new()
            .map_err(decode_error)?
            .with_outputs(OutputSelector::no_default().with("logits"));
        let inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = vec![
            ("input_ids".into(), ids.into()),
            ("encoder_attention_mask".into(), (&self.mask).into()),
            ("encoder_hidden_states".into(), (&self.hidden).into()),
        ];
        let outputs = self
            .decoder
            .run_with_options(inputs, &options)
            .map_err(decode_error)?;
        let (shape, logits) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(decode_error)?;
        last_rows(shape, logits, self.beams, Some(len))
    }

    fn step_cached(
        &mut self,
        hyps: &[Vec<i64>],
        past_names: &[String],
        present_names: &[String],
        (heads, head_dim): (usize, usize),
    ) -> Result<(Vec<f32>, usize)> {
        let first = self.past.is_empty();
        if first {
            // Caché inicial vacía: el modelo la ignora con `use_cache_branch = false`.
            for _ in past_names {
                let empty =
                    Tensor::<f32>::from_array(([self.beams, heads, 0usize, head_dim], Vec::new()))
                        .map_err(decode_error)?;
                self.past.push(empty.into_dyn());
            }
        }
        let ids = if first {
            tensor_i64(
                [self.beams, hyps[0].len()],
                hyps.iter().flatten().copied().collect(),
            )?
        } else {
            tensor_i64(
                [self.beams, 1],
                hyps.iter().map(|h| h[h.len() - 1]).collect(),
            )?
        };
        let flag = Tensor::from_array(([1usize], vec![!first]))
            .map_err(decode_error)?
            .into_dyn();
        let mut wanted = OutputSelector::no_default().with("logits");
        for name in present_names {
            // Las claves/valores del encoder solo se leen en el primer paso.
            if first || name.contains(".decoder.") {
                wanted = wanted.with(name.as_str());
            }
        }
        let options = RunOptions::new()
            .map_err(decode_error)?
            .with_outputs(wanted);

        let mut inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = vec![
            ("input_ids".into(), ids.into()),
            ("encoder_attention_mask".into(), (&self.mask).into()),
            ("encoder_hidden_states".into(), (&self.hidden).into()),
            ("use_cache_branch".into(), flag.into()),
        ];
        for (name, value) in past_names.iter().zip(&self.past) {
            inputs.push((name.as_str().into(), value.into()));
        }
        let mut outputs = self
            .decoder
            .run_with_options(inputs, &options)
            .map_err(decode_error)?;

        let (shape, logits) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(decode_error)?;
        let result = last_rows(shape, logits, self.beams, None)?;
        for (i, name) in present_names.iter().enumerate() {
            if first || name.contains(".decoder.") {
                self.past[i] = outputs.remove(name.as_str()).ok_or_else(|| {
                    translation_error(format!("the decoder produced no `{name}`"))
                })?;
            }
        }
        Ok(result)
    }
}

impl Decode for DecoderRun<'_> {
    fn step(&mut self, hyps: &[Vec<i64>]) -> Result<(Vec<f32>, usize)> {
        match self.kind {
            Kind::Plain => self.step_plain(hyps),
            Kind::Cached {
                past,
                present,
                heads,
                head_dim,
            } => self.step_cached(hyps, past, present, (*heads, *head_dim)),
        }
    }

    fn reorder(&mut self, parents: &[usize]) -> Result<()> {
        let Kind::Cached { present, .. } = self.kind else {
            return Ok(()); // sin caché cada paso reenvía las secuencias ya ordenadas
        };
        if parents.iter().copied().eq(0..parents.len()) {
            return Ok(());
        }
        for (i, name) in present.iter().enumerate() {
            if !name.contains(".decoder.") {
                continue; // las del encoder son idénticas en todos los haces
            }
            let (shape, data) = self.past[i]
                .try_extract_tensor::<f32>()
                .map_err(decode_error)?;
            let dims: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
            let block = data.len() / dims[0].max(1);
            let mut gathered = Vec::with_capacity(data.len());
            for &parent in parents {
                gathered.extend_from_slice(&data[parent * block..(parent + 1) * block]);
            }
            self.past[i] = Tensor::from_array((dims, gathered))
                .map_err(decode_error)?
                .into_dyn();
        }
        Ok(())
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
    fn the_last_row_of_each_beam_is_picked() {
        // 2 haces, 3 filas, vocab 2: fila i del haz b = [b*10+i, b*10+i+0.5].
        let mut logits = Vec::new();
        for b in 0..2 {
            for i in 0..3 {
                let v = (b * 10 + i) as f32;
                logits.extend([v, v + 0.5]);
            }
        }
        let (last, vocab) = last_rows(&[2, 3, 2], &logits, 2, Some(3)).unwrap();
        assert_eq!(vocab, 2);
        assert_eq!(last, [2.0, 2.5, 12.0, 12.5]);
        assert!(last_rows(&[2, 3, 2], &logits, 2, Some(1)).is_err());
        assert!(last_rows(&[2, 3, 2], &logits[1..], 2, None).is_err());
        assert!(last_rows(&[2, 0, 2], &[], 2, None).is_err());
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
