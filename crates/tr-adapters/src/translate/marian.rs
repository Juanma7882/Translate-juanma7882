//! Tokenizador de los modelos Marian (Opus-MT), sin dependencias nativas.
//!
//! El `tokenizer.json` publicado para estos modelos no es utilizable con la crate `tokenizers`
//! (su normalizador viene vacío), así que se reproduce lo que hace `MarianTokenizer` de
//! Hugging Face: normalizar con SentencePiece, segmentar con el modelo Unigram de `source.spm`
//! (Viterbi) y convertir las piezas a ids con `vocab.json`.

use std::collections::HashMap;
use std::path::Path;

use sentencepiece_model::SentencePieceModel;
use spm_precompiled::Precompiled;
use tr_core::{CoreError, Result};

const WORD_MARK: char = '▁';
/// Penalización de SentencePiece para un carácter que ninguna pieza cubre.
const UNKNOWN_PENALTY: f32 = 10.0;
/// Tipos de pieza de SentencePiece que se pueden usar al segmentar: normal y definida por el usuario.
const USABLE_PIECE_TYPES: [i32; 2] = [1, 4];

fn model_error(message: impl Into<String>) -> CoreError {
    CoreError::Model(message.into())
}

/// Segmentador Unigram: elige la partición de mayor puntuación total.
#[derive(Debug)]
struct Segmenter {
    pieces: HashMap<String, f32>,
    longest: usize,
    unknown_score: f32,
}

impl Segmenter {
    fn new(pieces: impl IntoIterator<Item = (String, f32)>) -> Self {
        let pieces: HashMap<String, f32> = pieces.into_iter().collect();
        let longest = pieces.keys().map(|p| p.chars().count()).max().unwrap_or(1);
        let lowest = pieces.values().copied().fold(f32::MAX, f32::min);
        let unknown_score = if pieces.is_empty() {
            -UNKNOWN_PENALTY
        } else {
            lowest - UNKNOWN_PENALTY
        };
        Self {
            pieces,
            longest,
            unknown_score,
        }
    }

    /// Divide `text` en piezas; un carácter sin pieza queda como trozo suelto (será `<unk>`).
    fn segment(&self, text: &str) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        let n = chars.len();
        // best[i] = (mejor puntuación para chars[..i], inicio del último trozo)
        let mut best = vec![(f32::NEG_INFINITY, 0usize); n + 1];
        best[0] = (0.0, 0);
        for start in 0..n {
            if best[start].0 == f32::NEG_INFINITY {
                continue;
            }
            for end in start + 1..=n.min(start + self.longest) {
                let piece: String = chars[start..end].iter().collect();
                let score = match self.pieces.get(&piece) {
                    Some(&score) => score,
                    None if end == start + 1 => self.unknown_score,
                    None => continue,
                };
                let total = best[start].0 + score;
                if total > best[end].0 {
                    best[end] = (total, start);
                }
            }
        }
        let mut tokens = Vec::new();
        let mut end = n;
        while end > 0 {
            let start = best[end].1;
            tokens.push(chars[start..end].iter().collect());
            end = start;
        }
        tokens.reverse();
        tokens
    }
}

#[derive(Debug)]
pub struct MarianTokenizer {
    normalizer: Option<Precompiled>,
    segmenter: Segmenter,
    vocab: HashMap<String, i64>,
    inverse: HashMap<i64, String>,
    unk_id: i64,
    eos_id: i64,
    /// Id con el que arranca el decoder (también se usa como relleno): nunca se genera.
    pub decoder_start_id: i64,
}

impl MarianTokenizer {
    /// Carga `source.spm`, `vocab.json` y `config.json` de la carpeta del modelo.
    pub fn load(dir: &Path) -> Result<Self> {
        let spm = SentencePieceModel::from_file(dir.join("source.spm"))
            .map_err(|e| model_error(format!("could not read `source.spm`: {e}")))?;
        let pieces = spm.pieces().iter().filter_map(|p| {
            let kind = p.r#type.unwrap_or(1);
            USABLE_PIECE_TYPES
                .contains(&kind)
                .then(|| (p.piece.clone().unwrap_or_default(), p.score.unwrap_or(0.0)))
        });
        let segmenter = Segmenter::new(pieces);
        let normalizer = spm
            .normalizer()
            .and_then(|n| n.precompiled_charsmap.as_ref())
            .filter(|charsmap| !charsmap.is_empty())
            .map(|charsmap| Precompiled::from(charsmap))
            .transpose()
            .map_err(|e| {
                model_error(format!("invalid normalization rules in `source.spm`: {e}"))
            })?;

        let read = |name: &str| {
            std::fs::read(dir.join(name))
                .map_err(|e| model_error(format!("could not read `{name}`: {e}")))
        };
        let vocab: HashMap<String, i64> = serde_json::from_slice(&read("vocab.json")?)
            .map_err(|e| model_error(format!("invalid `vocab.json`: {e}")))?;
        let config: serde_json::Value = serde_json::from_slice(&read("config.json")?)
            .map_err(|e| model_error(format!("invalid `config.json`: {e}")))?;
        let id = |key: &str| {
            config
                .get(key)
                .and_then(serde_json::Value::as_i64)
                .ok_or_else(|| model_error(format!("`config.json` has no `{key}`")))
        };
        let unk_id = *vocab
            .get("<unk>")
            .ok_or_else(|| model_error("`vocab.json` has no `<unk>`"))?;
        let inverse = vocab
            .iter()
            .map(|(piece, &id)| (id, piece.clone()))
            .collect();
        Ok(Self {
            normalizer,
            segmenter,
            vocab,
            inverse,
            unk_id,
            eos_id: id("eos_token_id")?,
            decoder_start_id: id("decoder_start_token_id")?,
        })
    }

    pub fn eos_id(&self) -> i64 {
        self.eos_id
    }

    /// Texto -> ids, terminado en `</s>`. Se queda con las primeras `max_tokens` piezas (la
    /// terminación incluida), para acotar el coste de entradas muy largas.
    pub fn encode(&self, text: &str, max_tokens: usize) -> Vec<i64> {
        let normalized = match &self.normalizer {
            Some(normalizer) => normalizer.normalize_string(text),
            None => text.to_owned(),
        };
        let words: Vec<&str> = normalized.split_whitespace().collect();
        let prepared = format!("{WORD_MARK}{}", words.join(&WORD_MARK.to_string()));
        let mut ids: Vec<i64> = self
            .segmenter
            .segment(&prepared)
            .iter()
            .take(max_tokens.saturating_sub(1))
            .map(|piece| self.vocab.get(piece).copied().unwrap_or(self.unk_id))
            .collect();
        ids.push(self.eos_id);
        ids
    }

    /// Ids -> texto: concatena las piezas, `▁` pasa a espacio y se ignoran `</s>` y el relleno.
    pub fn decode(&self, ids: &[i64]) -> String {
        let text: String = ids
            .iter()
            .filter(|&&id| id != self.eos_id && id != self.decoder_start_id)
            .filter_map(|id| self.inverse.get(id))
            .map(String::as_str)
            .collect();
        text.replace(WORD_MARK, " ").trim().to_owned()
    }

    #[cfg(test)]
    fn for_tests(pieces: &[(&str, f32)], vocab: &[(&str, i64)]) -> Self {
        let vocab: HashMap<String, i64> = vocab.iter().map(|&(p, i)| (p.to_owned(), i)).collect();
        Self {
            normalizer: None,
            segmenter: Segmenter::new(pieces.iter().map(|&(p, s)| (p.to_owned(), s))),
            inverse: vocab.iter().map(|(p, &i)| (i, p.clone())).collect(),
            unk_id: vocab["<unk>"],
            eos_id: vocab["</s>"],
            decoder_start_id: vocab["<pad>"],
            vocab,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segmenter(pieces: &[(&str, f32)]) -> Segmenter {
        Segmenter::new(pieces.iter().map(|&(p, s)| (p.to_owned(), s)))
    }

    fn tokenizer() -> MarianTokenizer {
        MarianTokenizer::for_tests(
            &[
                ("▁hello", -3.0),
                ("▁hel", -5.0),
                ("lo", -4.0),
                ("▁world", -3.5),
                ("▁", -2.0),
                ("h", -9.0),
                ("i", -9.0),
                ("▁hi", -4.0),
            ],
            &[
                ("<pad>", 99),
                ("</s>", 0),
                ("<unk>", 1),
                ("▁hello", 10),
                ("▁world", 11),
                ("▁hi", 12),
                ("▁hel", 13),
                ("lo", 14),
            ],
        )
    }

    #[test]
    fn the_best_scoring_segmentation_wins() {
        let s = segmenter(&[("▁hello", -3.0), ("▁hel", -5.0), ("lo", -4.0)]);
        assert_eq!(
            s.segment("▁hello"),
            ["▁hello"],
            "una pieza (-3) gana a dos (-9)"
        );
        let s = segmenter(&[("▁hello", -30.0), ("▁hel", -5.0), ("lo", -4.0)]);
        assert_eq!(
            s.segment("▁hello"),
            ["▁hel", "lo"],
            "dos piezas (-9) ganan a una (-30)"
        );
    }

    #[test]
    fn characters_without_a_piece_are_kept_as_single_unknowns() {
        let s = segmenter(&[("▁a", -1.0)]);
        assert_eq!(s.segment("▁a☃▁a"), ["▁a", "☃", "▁a"]);
    }

    #[test]
    fn empty_and_unicode_inputs_do_not_panic() {
        let s = segmenter(&[("▁", -1.0)]);
        assert!(s.segment("").is_empty());
        assert_eq!(s.segment("▁日本"), ["▁", "日", "本"]);
        assert!(segmenter(&[]).segment("abc").len() == 3);
    }

    #[test]
    fn encoding_prefixes_the_word_mark_collapses_spaces_and_ends_with_eos() {
        let t = tokenizer();
        assert_eq!(t.encode("hello   world", 128), [10, 11, 0]);
        assert_eq!(t.encode("  hello \n world ", 128), [10, 11, 0]);
        assert_eq!(t.encode("hi", 128), [12, 0]);
    }

    #[test]
    fn unknown_pieces_map_to_unk() {
        let t = tokenizer();
        assert_eq!(
            t.encode("hello ☃", 128),
            [10, 1, 1, 0],
            "▁ y ☃ aparte; ▁ no está en el vocabulario"
        );
    }

    #[test]
    fn long_inputs_are_cut_but_always_end_with_eos() {
        let t = tokenizer();
        let text = "hello ".repeat(500);
        let ids = t.encode(&text, 8);
        assert_eq!(ids.len(), 8);
        assert_eq!(*ids.last().unwrap(), 0);
        assert!(
            t.encode("hello", 1) == [0],
            "con un solo hueco queda solo la terminación"
        );
        assert!(t.encode("hello", 0) == [0]);
    }

    #[test]
    fn decoding_joins_pieces_and_ignores_special_tokens() {
        let t = tokenizer();
        assert_eq!(t.decode(&[99, 10, 11, 0]), "hello world");
        assert_eq!(t.decode(&[13, 14, 11]), "hello world");
        assert_eq!(t.decode(&[0, 99]), "");
        assert_eq!(t.decode(&[777_777]), "", "ids desconocidos se ignoran");
    }

    #[test]
    fn loading_from_a_missing_folder_is_a_model_error() {
        let error = MarianTokenizer::load(Path::new("/definitely/not/here")).unwrap_err();
        assert!(matches!(error, CoreError::Model(_)), "{error}");
    }
}
