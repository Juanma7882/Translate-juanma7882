//! Reconocimiento de voz con Whisper en ONNX (encoder + decoder int8 de `Xenova/whisper-*`).
//!
//! Se ejecuta con el mismo `ort` que el OCR y la traducción. Los modelos se leen de una carpeta;
//! el audio llega como buffers en memoria y nunca se escribe ni se registra.
//!
//! Decodificación voraz con caché de claves/valores (decoder "merged"): el encoder corre una vez por
//! ventana y cada paso del decoder procesa un solo token.

use std::borrow::Cow;
use std::path::Path;

use ort::session::{OutputSelector, RunOptions, Session, SessionInputValue};
use ort::value::{DynValue, Tensor};
use tr_core::{AudioChunk, CoreError, Lang, Result, Segment, SpeechToText};

use crate::perf::PerfConfig;

use super::mel::{self, LogMel};
use super::tokenizer::WhisperTokenizer;
use super::utterance::Utterance;

/// Archivos que debe tener la carpeta del modelo.
pub const MODEL_FILES: [&str; 4] = [
    "encoder.onnx",
    "decoder.onnx",
    "vocab.json",
    "added_tokens.json",
];

/// Piezas generadas como máximo por segundo de audio (el habla rápida ronda 6-8) y margen fijo.
const TOKENS_PER_SECOND: f32 = 10.0;
const TOKEN_MARGIN: usize = 8;
/// Más allá de esto el modelo se considera atascado repitiendo.
const MAX_REPEAT: usize = 4;
/// Probabilidad de "sin voz" y logprob medio a partir de los cuales se descarta una ventana.
const NO_SPEECH_THRESHOLD: f32 = 0.6;
const LOGPROB_THRESHOLD: f32 = -1.0;

fn stt_error(message: impl Into<String>) -> CoreError {
    CoreError::Stt(message.into())
}

/// Resultado de transcribir una ventana.
#[derive(Debug, Clone, PartialEq)]
pub struct Transcript {
    pub text: String,
    /// Logprob medio por token generado.
    pub avg_logprob: f32,
    /// Probabilidad de que la ventana no contenga voz según el propio modelo.
    pub no_speech: f32,
}

/// Id de mayor puntuación entre `logits` (NaN cuenta como la peor); `allowed` filtra candidatos.
fn argmax(logits: &[f32], allowed: impl Fn(usize) -> bool) -> Option<usize> {
    logits
        .iter()
        .enumerate()
        .filter(|&(id, score)| !score.is_nan() && allowed(id))
        .fold(
            None,
            |best: Option<(usize, f32)>, (id, &score)| match best {
                Some((_, top)) if top >= score => best,
                _ => Some((id, score)),
            },
        )
        .map(|(id, _)| id)
}

/// Logprob de `id` bajo softmax de `logits` (estable numéricamente).
fn log_prob(logits: &[f32], id: usize) -> f32 {
    let max = logits.iter().copied().fold(f32::MIN, f32::max);
    let sum: f32 = logits.iter().map(|l| (l - max).exp()).sum();
    logits[id] - max - sum.ln()
}

/// Whisper describe lo que no es habla entre corchetes o paréntesis (`[BLANK_AUDIO]`, `(música)`)
/// o con notas musicales: no es algo que haya que subtitular.
fn is_non_speech(text: &str) -> bool {
    let text = text.trim();
    let wrapped = |open: char, close: char| text.starts_with(open) && text.ends_with(close);
    wrapped('[', ']')
        || wrapped('(', ')')
        || wrapped('*', '*')
        || text.chars().all(|c| !c.is_alphanumeric())
}

fn tokens_limit(seconds: f32) -> usize {
    (seconds * TOKENS_PER_SECOND) as usize + TOKEN_MARGIN
}

/// El modelo se repite sin avanzar: el último token o el último par se repiten demasiado.
fn is_looping(tokens: &[i64]) -> bool {
    let n = tokens.len();
    if n >= MAX_REPEAT && tokens[n - MAX_REPEAT..].iter().all(|&t| t == tokens[n - 1]) {
        return true;
    }
    let pairs = 3;
    if n >= pairs * 2 {
        let tail = &tokens[n - 2..];
        return (1..pairs).all(|k| &tokens[n - 2 - 2 * k..n - 2 * k] == tail);
    }
    false
}

pub struct WhisperStt {
    encoder: Session,
    decoder: Session,
    tokenizer: WhisperTokenizer,
    mel: LogMel,
    language: i64,
    utterance: Utterance,
    /// Nombres de las entradas `past_key_values.*` del decoder, en orden.
    past_names: Vec<String>,
    /// Nombres de las salidas `present.*` correspondientes.
    present_names: Vec<String>,
}

impl WhisperStt {
    /// Carga los modelos de `model_dir` para reconocer voz en `from`.
    pub fn load(model_dir: &Path, from: &Lang) -> Result<Self> {
        Self::load_with(model_dir, from, &PerfConfig::default())
    }

    /// Como [`Self::load`] con los hilos de `perf`. El encoder, el decoder y el tokenizador se
    /// cargan en paralelo.
    pub fn load_with(model_dir: &Path, from: &Lang, perf: &PerfConfig) -> Result<Self> {
        let missing: Vec<&str> = MODEL_FILES
            .iter()
            .copied()
            .filter(|name| !model_dir.join(name).is_file())
            .collect();
        if !missing.is_empty() {
            return Err(CoreError::Model(format!(
                "the speech model is incomplete; missing: {}",
                missing.join(", ")
            )));
        }
        let threads = perf.threads();
        let (tokenizer, encoder, decoder) = std::thread::scope(|scope| {
            let encoder = scope
                .spawn(|| crate::perf::session(&model_dir.join("encoder.onnx"), threads, false));
            let decoder = scope
                .spawn(|| crate::perf::session(&model_dir.join("decoder.onnx"), threads, false));
            let tokenizer = WhisperTokenizer::load(model_dir);
            let joined = |handle: std::thread::ScopedJoinHandle<'_, Result<Session>>| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err(CoreError::Model("model loading panicked".into())))
            };
            (tokenizer, joined(encoder), joined(decoder))
        });
        let tokenizer = tokenizer?;
        let language = tokenizer.language(from)?;
        let decoder = decoder?;
        let past_names: Vec<String> = decoder
            .inputs()
            .iter()
            .map(|i| i.name().to_owned())
            .filter(|n| n.starts_with("past_key_values."))
            .collect();
        if past_names.is_empty()
            || !decoder
                .inputs()
                .iter()
                .any(|i| i.name() == "use_cache_branch")
        {
            return Err(CoreError::Model(
                "the speech decoder must be the `merged` export (with `use_cache_branch`)".into(),
            ));
        }
        let present_names = past_names
            .iter()
            .map(|n| n.replacen("past_key_values.", "present.", 1))
            .collect();
        Ok(Self {
            encoder: encoder?,
            decoder,
            tokenizer,
            mel: LogMel::new(),
            language,
            utterance: Utterance::default(),
            past_names,
            present_names,
        })
    }

    /// Transcribe hasta 30 s de audio. `None` si el modelo considera que no hay voz.
    pub fn transcribe(&mut self, samples: &[f32]) -> Result<Option<Transcript>> {
        if samples.is_empty() {
            return Ok(None);
        }
        let seconds = samples.len() as f32 / mel::SAMPLE_RATE as f32;
        let features = self.mel.compute(samples);
        let hidden = self.encode(features)?;
        self.decode(&hidden, tokens_limit(seconds))
    }

    fn encode(&mut self, features: Vec<f32>) -> Result<DynValue> {
        let fail = |e: ort::Error| stt_error(format!("encoding failed: {e}"));
        let input =
            Tensor::from_array(([1usize, mel::N_MELS, mel::N_FRAMES], features)).map_err(fail)?;
        // El export trae las atenciones del encoder (cientos de MB por llamada): no se piden.
        let options = RunOptions::new()
            .map_err(fail)?
            .with_outputs(OutputSelector::no_default().with("last_hidden_state"));
        let mut outputs = self
            .encoder
            .run_with_options(ort::inputs!["input_features" => input], &options)
            .map_err(fail)?;
        outputs
            .remove("last_hidden_state")
            .ok_or_else(|| stt_error("the encoder produced no output"))
    }

    /// Tensor vacío de la caché inicial: `[1, cabezas, 0, dim]` (el modelo lo ignora en el primer paso).
    fn empty_past(&self, index: usize) -> Result<DynValue> {
        let name = &self.past_names[index];
        let shape = self
            .decoder
            .inputs()
            .iter()
            .find(|i| i.name() == name)
            .and_then(|i| i.dtype().tensor_shape())
            .ok_or_else(|| stt_error(format!("unexpected type for `{name}`")))?;
        let dim = |axis: usize| shape.get(axis).copied().filter(|&d| d > 0).unwrap_or(1) as usize;
        let tensor = Tensor::<f32>::from_array(([1usize, dim(1), 0usize, dim(3)], Vec::new()))
            .map_err(|e| stt_error(format!("decoding failed: {e}")))?;
        Ok(tensor.into_dyn())
    }

    fn decode(&mut self, hidden: &DynValue, limit: usize) -> Result<Option<Transcript>> {
        let fail = |e: ort::Error| stt_error(format!("decoding failed: {e}"));
        let tk = &self.tokenizer;
        let (eot, first_special) = (tk.eot as usize, tk.first_special as usize);
        let space = tk.space.map(|id| id as usize);
        let no_speech_id = tk.no_speech.map(|id| id as usize);
        let prompt = vec![tk.sot, self.language, tk.transcribe, tk.no_timestamps];

        let mut wanted = OutputSelector::no_default().with("logits");
        for name in &self.present_names {
            wanted = wanted.with(name.as_str());
        }
        let options = RunOptions::new().map_err(fail)?.with_outputs(wanted);

        // Caché de claves/valores: la del encoder se calcula una vez y no cambia.
        let mut past: Vec<DynValue> = (0..self.past_names.len())
            .map(|i| self.empty_past(i))
            .collect::<Result<_>>()?;
        let mut use_cache = false;
        let mut input_ids = prompt;
        let mut generated: Vec<i64> = Vec::new();
        let (mut logprob_sum, mut no_speech) = (0.0f32, 0.0f32);

        for step in 0..=limit {
            let ids = Tensor::from_array(([1usize, input_ids.len()], input_ids.clone()))
                .map_err(fail)?
                .into_dyn();
            let flag = Tensor::from_array(([1usize], vec![use_cache]))
                .map_err(fail)?
                .into_dyn();
            let mut inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = vec![
                ("input_ids".into(), ids.into()),
                ("encoder_hidden_states".into(), hidden.into()),
                ("use_cache_branch".into(), flag.into()),
            ];
            for (name, value) in self.past_names.iter().zip(&past) {
                inputs.push((name.as_str().into(), value.into()));
            }
            let mut outputs = self
                .decoder
                .run_with_options(inputs, &options)
                .map_err(fail)?;

            let (shape, logits) = outputs["logits"]
                .try_extract_tensor::<f32>()
                .map_err(fail)?;
            let vocab = shape.get(2).copied().unwrap_or(0) as usize;
            let rows = shape.get(1).copied().unwrap_or(0) as usize;
            if vocab == 0 || rows == 0 || logits.len() < rows * vocab {
                return Err(stt_error("unexpected logits shape"));
            }
            if step == 0
                && let Some(id) = no_speech_id.filter(|&id| id < vocab)
            {
                // La probabilidad de "sin voz" se lee en la posición de `<|startoftranscript|>`.
                no_speech = log_prob(&logits[..vocab], id).exp();
            }
            let last = &logits[(rows - 1) * vocab..rows * vocab];
            let first_token = generated.is_empty();
            let next = argmax(last, |id| {
                let text = id < first_special;
                // Sin timestamps ni tokens de control; el primer token no puede ser blanco ni fin.
                (text || id == eot) && !(first_token && (id == eot || Some(id) == space))
            })
            .ok_or_else(|| stt_error("the model produced no valid token"))?;
            if next == eot {
                break;
            }
            logprob_sum += log_prob(last, next);
            generated.push(next as i64);

            // Actualizar la caché: en el primer paso entra todo; después, solo la del decoder.
            for (i, name) in self.present_names.iter().enumerate() {
                let is_decoder = name.contains(".decoder.");
                if !use_cache || is_decoder {
                    past[i] = outputs
                        .remove(name.as_str())
                        .ok_or_else(|| stt_error(format!("the decoder produced no `{name}`")))?;
                }
            }
            drop(outputs);
            use_cache = true;
            input_ids = vec![next as i64];
            if is_looping(&generated) {
                break;
            }
        }

        let text = self.tokenizer.decode(&generated);
        if text.is_empty() || is_non_speech(&text) {
            return Ok(None);
        }
        let avg_logprob = logprob_sum / generated.len().max(1) as f32;
        if no_speech > NO_SPEECH_THRESHOLD && avg_logprob < LOGPROB_THRESHOLD {
            return Ok(None);
        }
        Ok(Some(Transcript {
            text,
            avg_logprob,
            no_speech,
        }))
    }
}

impl SpeechToText for WhisperStt {
    fn push(&mut self, chunk: &AudioChunk) -> Result<Vec<Segment>> {
        self.push_window(chunk, true)
    }

    fn push_window(&mut self, chunk: &AudioChunk, closes_utterance: bool) -> Result<Vec<Segment>> {
        let end = chunk.start + chunk.duration();
        let text = self
            .transcribe(&chunk.samples)?
            .map(|t| t.text)
            .unwrap_or_default();
        Ok(self
            .utterance
            .update(&text, chunk.start, end, closes_utterance)
            .into_iter()
            .collect())
    }

    fn end_utterance(&mut self) -> Result<Vec<Segment>> {
        Ok(self.utterance.finish().into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_best_allowed_token_wins() {
        assert_eq!(argmax(&[0.1, 0.9, 0.5], |_| true), Some(1));
        assert_eq!(argmax(&[0.1, 0.9, 0.5], |id| id != 1), Some(2));
        assert_eq!(argmax(&[-5.0, -2.0, -9.0], |_| true), Some(1));
    }

    #[test]
    fn nan_and_ties_are_handled() {
        assert_eq!(argmax(&[f32::NAN, 0.5, f32::NAN], |_| true), Some(1));
        assert_eq!(argmax(&[1.0, 1.0], |_| true), Some(0));
        assert_eq!(argmax(&[f32::NAN], |_| true), None);
        assert_eq!(argmax(&[], |_| true), None);
        assert_eq!(argmax(&[1.0], |_| false), None);
    }

    #[test]
    fn log_prob_is_a_proper_log_softmax() {
        let logits = [1.0f32, 2.0, 3.0];
        let total: f32 = (0..3).map(|i| log_prob(&logits, i).exp()).sum();
        assert!((total - 1.0).abs() < 1e-5);
        assert!(log_prob(&logits, 2) > log_prob(&logits, 0));
        // Estable con valores grandes.
        assert!(log_prob(&[1000.0, 1000.0], 0).is_finite());
    }

    #[test]
    fn annotations_and_noise_are_not_speech() {
        for text in [
            "[BLANK_AUDIO]",
            "(music)",
            " [Música] ",
            "*applause*",
            "♪♪",
            "...",
            "",
        ] {
            assert!(is_non_speech(text), "{text:?}");
        }
        for text in [
            "Hello.",
            "Where is the train station? (Over there)",
            "日本語",
            "42",
        ] {
            assert!(!is_non_speech(text), "{text:?}");
        }
    }

    #[test]
    fn the_token_limit_grows_with_the_audio() {
        assert_eq!(tokens_limit(0.0), TOKEN_MARGIN);
        assert_eq!(tokens_limit(2.0), 28);
        assert!(tokens_limit(30.0) > tokens_limit(2.0));
    }

    #[test]
    fn repeated_tokens_and_pairs_are_detected_as_loops() {
        assert!(is_looping(&[5, 7, 7, 7, 7]));
        assert!(!is_looping(&[5, 7, 7, 7]));
        assert!(is_looping(&[1, 9, 8, 9, 8, 9, 8]));
        assert!(!is_looping(&[1, 2, 3, 4, 5, 6, 7]));
        assert!(!is_looping(&[]));
    }

    #[test]
    fn loading_without_models_names_the_missing_files() {
        let dir = std::env::temp_dir().join(format!("tr-stt-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let Err(error) = WhisperStt::load(&dir, &Lang::new("en").unwrap()) else {
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
        let Err(error) =
            WhisperStt::load(Path::new("/definitely/not/here"), &Lang::new("en").unwrap())
        else {
            panic!("debe fallar")
        };
        assert!(matches!(error, CoreError::Model(_)));
    }
}
