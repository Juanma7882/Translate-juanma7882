//! Vocabulario de Whisper: ids de tokens especiales, de idioma y conversión de ids a texto.
//!
//! Whisper usa BPE a nivel de bytes (el de GPT-2): cada pieza de `vocab.json` está escrita con el
//! alfabeto "bytes a unicode". Para decodificar basta invertir ese alfabeto y juntar los bytes; el
//! codificado no hace falta porque el modelo solo recibe audio.

use std::collections::HashMap;
use std::path::Path;

use tr_core::{CoreError, Lang, Result};

fn model_error(message: impl Into<String>) -> CoreError {
    CoreError::Model(message.into())
}

/// Tabla inversa de GPT-2 `bytes_to_unicode`: carácter -> byte.
fn byte_decoder() -> HashMap<char, u8> {
    let mut printable: Vec<u32> = (33..=126).chain(161..=172).chain(174..=255).collect();
    let mut mapped: Vec<u32> = printable.clone();
    let mut extra = 0;
    for byte in 0..=255u32 {
        if !printable.contains(&byte) {
            printable.push(byte);
            mapped.push(256 + extra);
            extra += 1;
        }
    }
    printable
        .into_iter()
        .zip(mapped)
        .filter_map(|(byte, ch)| char::from_u32(ch).map(|c| (c, byte as u8)))
        .collect()
}

#[derive(Debug)]
pub struct WhisperTokenizer {
    /// id -> bytes de la pieza (solo tokens de texto).
    pieces: HashMap<i64, Vec<u8>>,
    languages: HashMap<String, i64>,
    pub sot: i64,
    pub eot: i64,
    pub transcribe: i64,
    pub no_timestamps: i64,
    pub no_speech: Option<i64>,
    /// Primer id que no es texto (`<|endoftext|>` y todo lo posterior).
    pub first_special: i64,
    /// Id de `" "` (se suprime como primer token).
    pub space: Option<i64>,
}

impl WhisperTokenizer {
    /// Lee `vocab.json` y `added_tokens.json` de la carpeta del modelo.
    pub fn load(dir: &Path) -> Result<Self> {
        let read = |name: &str| {
            std::fs::read(dir.join(name))
                .map_err(|e| model_error(format!("could not read `{name}`: {e}")))
        };
        Self::from_json(&read("vocab.json")?, &read("added_tokens.json")?)
    }

    pub fn from_json(vocab: &[u8], added: &[u8]) -> Result<Self> {
        let vocab: HashMap<String, i64> = serde_json::from_slice(vocab)
            .map_err(|e| model_error(format!("invalid `vocab.json`: {e}")))?;
        let added: HashMap<String, i64> = serde_json::from_slice(added)
            .map_err(|e| model_error(format!("invalid `added_tokens.json`: {e}")))?;
        let special = |name: &str| {
            added
                .get(name)
                .copied()
                .ok_or_else(|| model_error(format!("`added_tokens.json` has no `{name}`")))
        };
        // En Whisper `<|endoftext|>` vive en `vocab.json`; otros exports lo repiten en `added_tokens.json`.
        let eot = match vocab.get("<|endoftext|>") {
            Some(&id) => id,
            None => special("<|endoftext|>")?,
        };
        let decoder = byte_decoder();
        let pieces: HashMap<i64, Vec<u8>> = vocab
            .iter()
            .filter(|&(_, &id)| id < eot)
            .map(|(piece, &id)| {
                let bytes = piece
                    .chars()
                    .filter_map(|c| decoder.get(&c).copied())
                    .collect();
                (id, bytes)
            })
            .collect();
        let languages = added
            .iter()
            .filter_map(|(name, &id)| {
                let code = name.strip_prefix("<|")?.strip_suffix("|>")?;
                let is_language = (2..=3).contains(&code.len())
                    && code.bytes().all(|b| b.is_ascii_lowercase())
                    && id > eot
                    && id < special("<|translate|>").ok()?;
                is_language.then(|| (code.to_owned(), id))
            })
            .collect();
        Ok(Self {
            pieces,
            languages,
            sot: special("<|startoftranscript|>")?,
            eot,
            transcribe: special("<|transcribe|>")?,
            no_timestamps: special("<|notimestamps|>")?,
            no_speech: added
                .get("<|nospeech|>")
                .or_else(|| added.get("<|nocaptions|>"))
                .copied(),
            first_special: eot,
            space: vocab.get("\u{120}").copied(),
        })
    }

    /// Token de idioma de `lang` (solo la subetiqueta principal: `es-MX` -> `es`).
    pub fn language(&self, lang: &Lang) -> Result<i64> {
        let primary = lang.as_str().split('-').next().unwrap_or_default();
        self.languages.get(primary).copied().ok_or_else(|| {
            CoreError::InvalidArgument(format!("the speech model does not support `{lang}`"))
        })
    }

    /// Ids -> texto. Ignora los tokens especiales; los bytes de un carácter partido entre piezas
    /// se juntan antes de interpretar el UTF-8.
    pub fn decode(&self, ids: &[i64]) -> String {
        let bytes: Vec<u8> = ids
            .iter()
            .filter_map(|id| self.pieces.get(id))
            .flatten()
            .copied()
            .collect();
        String::from_utf8_lossy(&bytes).trim().to_owned()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Vocabulario mínimo: "Ġhello", "Ġworld", un carácter japonés partido en dos piezas.
    pub fn tokenizer() -> WhisperTokenizer {
        // "日" = E6 97 A5 -> bytes a unicode: æ (E6), Ĺ (0x97 -> 256+n)... se construye con la tabla real.
        let decoder = byte_decoder();
        let encode = |bytes: &[u8]| -> String {
            let inverse: HashMap<u8, char> = decoder.iter().map(|(&c, &b)| (b, c)).collect();
            bytes.iter().map(|b| inverse[b]).collect()
        };
        let vocab = serde_json::json!({
            encode(b" hello"): 10,
            encode(b" world"): 11,
            encode(&[0xE6, 0x97]): 12,
            encode(&[0xA5]): 13,
            encode(b" "): 14,
        });
        let added = serde_json::json!({
            "<|endoftext|>": 100,
            "<|startoftranscript|>": 101,
            "<|en|>": 102,
            "<|es|>": 103,
            "<|ja|>": 104,
            "<|translate|>": 110,
            "<|transcribe|>": 111,
            "<|nospeech|>": 112,
            "<|notimestamps|>": 113,
        });
        WhisperTokenizer::from_json(vocab.to_string().as_bytes(), added.to_string().as_bytes())
            .unwrap()
    }

    #[test]
    fn byte_alphabet_covers_all_bytes() {
        let decoder = byte_decoder();
        assert_eq!(decoder.len(), 256);
        assert_eq!(decoder[&'a'], b'a');
        assert_eq!(decoder[&'\u{120}'], b' ', "Ġ es el espacio");
    }

    #[test]
    fn text_is_joined_and_trimmed() {
        let t = tokenizer();
        assert_eq!(t.decode(&[10, 11]), "hello world");
        assert_eq!(t.decode(&[14, 10]), "hello");
    }

    #[test]
    fn a_character_split_across_pieces_is_rebuilt() {
        assert_eq!(tokenizer().decode(&[12, 13]), "日");
    }

    #[test]
    fn special_and_unknown_tokens_are_skipped() {
        let t = tokenizer();
        assert_eq!(t.decode(&[101, 102, 111, 113, 10, 100]), "hello");
        assert_eq!(t.decode(&[9999]), "");
    }

    #[test]
    fn languages_resolve_by_primary_subtag() {
        let t = tokenizer();
        let lang = |c: &str| Lang::new(c).unwrap();
        assert_eq!(t.language(&lang("es-MX")).unwrap(), 103);
        assert_eq!(t.language(&lang("EN")).unwrap(), 102);
        assert!(matches!(
            t.language(&lang("fr")),
            Err(CoreError::InvalidArgument(_))
        ));
        assert!(t.language(&lang("ja")).is_ok());
    }

    #[test]
    fn special_ids_are_read_from_added_tokens() {
        let t = tokenizer();
        assert_eq!(
            (t.sot, t.eot, t.transcribe, t.no_timestamps, t.no_speech),
            (101, 100, 111, 113, Some(112))
        );
    }

    #[test]
    fn a_vocabulary_without_the_required_tokens_is_a_model_error() {
        let error = WhisperTokenizer::from_json(b"{}", b"{}").unwrap_err();
        assert!(matches!(error, CoreError::Model(_)), "{error}");
        let error = WhisperTokenizer::from_json(b"nope", b"{}").unwrap_err();
        assert!(matches!(error, CoreError::Model(_)), "{error}");
    }
}
