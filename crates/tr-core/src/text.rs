//! Normalización y estabilización del texto reconocido.

use crate::types::TextBlock;

/// Recorta y colapsa cualquier secuencia de espacios en un solo espacio.
pub fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Une los bloques del OCR (en el orden recibido) en un único texto normalizado.
/// Descarta los bloques por debajo de `min_confidence` y los vacíos.
pub fn join_blocks(blocks: &[TextBlock], min_confidence: f32) -> String {
    let parts: Vec<String> = blocks
        .iter()
        .filter(|b| b.confidence >= min_confidence)
        .map(|b| normalize(&b.text))
        .filter(|t| !t.is_empty())
        .collect();
    parts.join(" ")
}

/// Emite un texto solo cuando se observa igual en `required` frames consecutivos.
///
/// Un texto vacío reinicia el estado, de modo que si el mismo texto reaparece después
/// de una ausencia vuelve a emitirse.
pub struct Stabilizer {
    required: usize,
    candidate: String,
    count: usize,
    emitted: Option<String>,
}

impl Stabilizer {
    pub fn new(required: usize) -> Self {
        Self {
            required: required.max(1),
            candidate: String::new(),
            count: 0,
            emitted: None,
        }
    }

    /// Olvida lo observado y lo emitido: el texto actual volverá a emitirse al estabilizarse.
    pub fn reset(&mut self) {
        self.candidate.clear();
        self.count = 0;
        self.emitted = None;
    }

    /// `text` debe venir normalizado. Devuelve `Some` cuando el texto queda estable
    /// y es distinto del último emitido.
    pub fn observe(&mut self, text: &str) -> Option<String> {
        if text.is_empty() {
            self.reset();
            return None;
        }
        if text == self.candidate {
            self.count += 1;
        } else {
            self.candidate.clear();
            self.candidate.push_str(text);
            self.count = 1;
        }
        if self.count >= self.required && self.emitted.as_deref() != Some(text) {
            self.emitted = Some(text.to_owned());
            return self.emitted.clone();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(text: &str, confidence: f32) -> TextBlock {
        TextBlock {
            confidence,
            ..TextBlock::new(text)
        }
    }

    #[test]
    fn normalize_trims_and_collapses_whitespace() {
        assert_eq!(normalize("  hello \n\t  world  "), "hello world");
        assert_eq!(normalize("   "), "");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn join_blocks_orders_filters_and_normalizes() {
        let blocks = [
            block(" Hello ", 0.9),
            block("noise", 0.1),
            block("  ", 1.0),
            block("world", 0.8),
        ];
        assert_eq!(join_blocks(&blocks, 0.5), "Hello world");
        assert_eq!(join_blocks(&[], 0.5), "");
    }

    #[test]
    fn stable_text_is_emitted_once_after_two_frames() {
        let mut s = Stabilizer::new(2);
        assert_eq!(s.observe("hi"), None);
        assert_eq!(s.observe("hi"), Some("hi".into()));
        assert_eq!(s.observe("hi"), None);
        assert_eq!(s.observe("hi"), None);
    }

    #[test]
    fn changing_text_is_not_emitted_until_it_repeats() {
        let mut s = Stabilizer::new(2);
        assert_eq!(s.observe("he"), None);
        assert_eq!(s.observe("hel"), None);
        assert_eq!(s.observe("hello"), None);
        assert_eq!(s.observe("hello"), Some("hello".into()));
    }

    #[test]
    fn new_stable_text_replaces_the_previous_one() {
        let mut s = Stabilizer::new(2);
        s.observe("a");
        assert_eq!(s.observe("a"), Some("a".into()));
        assert_eq!(s.observe("b"), None);
        assert_eq!(s.observe("b"), Some("b".into()));
    }

    #[test]
    fn empty_text_resets_so_reappearance_is_emitted_again() {
        let mut s = Stabilizer::new(2);
        s.observe("a");
        assert_eq!(s.observe("a"), Some("a".into()));
        assert_eq!(s.observe(""), None);
        assert_eq!(s.observe("a"), None);
        assert_eq!(s.observe("a"), Some("a".into()));
    }

    #[test]
    fn single_frame_requirement_emits_immediately() {
        let mut s = Stabilizer::new(1);
        assert_eq!(s.observe("x"), Some("x".into()));
        assert_eq!(s.observe("x"), None);
        assert_eq!(Stabilizer::new(0).observe("y"), Some("y".into()));
    }
}
