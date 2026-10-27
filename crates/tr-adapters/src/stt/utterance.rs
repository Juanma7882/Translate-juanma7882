//! Une los textos de las ventanas de una misma intervención en un subtítulo cada vez más largo.
//!
//! El pipeline de `tr-core` envía ventanas cortas con solape. Cada ventana se transcribe por
//! separado, así que aquí se acumula el texto de la intervención: mientras habla se emite un
//! parcial con lo dicho hasta ahora y, al cerrarse (o si se alarga demasiado), un final con la
//! frase completa, que es lo que se traduce.

use std::time::Duration;

use tr_core::audio::dedupe_overlap;
use tr_core::{Segment, SegmentKind};

/// Una intervención continua más larga que esto se cierra aunque no haya pausa.
pub const MAX_UTTERANCE: Duration = Duration::from_secs(8);

#[derive(Debug, Default)]
pub struct Utterance {
    text: String,
    start: Option<Duration>,
    /// Fin de la última ventana incorporada.
    last_end: Duration,
}

impl Utterance {
    /// Texto acumulado y todavía no cerrado.
    pub fn pending(&self) -> &str {
        &self.text
    }

    fn take(&mut self, end: Duration, kind: SegmentKind) -> Option<Segment> {
        let start = self.start.take().unwrap_or(end);
        let text = std::mem::take(&mut self.text);
        (!text.is_empty()).then(|| Segment::new(text, kind, start, end))
    }

    /// Cierra lo pendiente (la intervención terminó sin ventana de cierre).
    pub fn finish(&mut self) -> Option<Segment> {
        let end = self.last_end;
        self.take(end, SegmentKind::Final)
    }

    /// Incorpora el texto de una ventana (`start..end`). `closes` indica que tras ella hay silencio.
    pub fn update(
        &mut self,
        window_text: &str,
        start: Duration,
        end: Duration,
        closes: bool,
    ) -> Option<Segment> {
        let window_text = window_text.split_whitespace().collect::<Vec<_>>().join(" ");
        self.last_end = end;
        if !window_text.is_empty() {
            self.start.get_or_insert(start);
            if self.text.is_empty() {
                self.text = window_text;
            } else {
                let new = dedupe_overlap(&self.text, &window_text);
                if !new.is_empty() {
                    self.text.push(' ');
                    self.text.push_str(&new);
                }
            }
        }
        if self.text.is_empty() {
            self.start = None;
            return None;
        }
        let too_long = self
            .start
            .is_some_and(|s| end.saturating_sub(s) >= MAX_UTTERANCE);
        if closes || too_long {
            return self.take(end, SegmentKind::Final);
        }
        Some(Segment::new(
            self.text.clone(),
            SegmentKind::Partial,
            self.start.unwrap_or(start),
            end,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(s: f64) -> Duration {
        Duration::from_secs_f64(s)
    }

    #[test]
    fn windows_accumulate_into_partials_and_close_with_a_final() {
        let mut u = Utterance::default();
        let a = u
            .update("where is the", secs(0.0), secs(2.0), false)
            .unwrap();
        assert_eq!(
            (a.kind, a.text.as_str()),
            (SegmentKind::Partial, "where is the")
        );
        let b = u
            .update("is the train station", secs(1.5), secs(3.5), false)
            .unwrap();
        assert_eq!(
            b.text, "where is the train station",
            "el solape no se repite"
        );
        assert_eq!(b.start, secs(0.0));
        let c = u.update("station", secs(3.0), secs(4.0), true).unwrap();
        assert_eq!(c.kind, SegmentKind::Final);
        assert_eq!(
            c.text, "where is the train station",
            "la palabra solapada no se duplica"
        );
        assert!(u.pending().is_empty(), "queda vacía tras cerrar");
    }

    #[test]
    fn a_closing_window_without_new_text_still_finalizes_what_was_heard() {
        let mut u = Utterance::default();
        u.update("good morning", secs(0.0), secs(2.0), false);
        let f = u.update("", secs(2.0), secs(2.3), true).unwrap();
        assert_eq!(
            (f.kind, f.text.as_str()),
            (SegmentKind::Final, "good morning")
        );
    }

    #[test]
    fn finishing_closes_the_pending_text_once() {
        let mut u = Utterance::default();
        assert!(u.finish().is_none());
        u.update("good evening", secs(0.0), secs(2.0), false);
        let f = u.finish().unwrap();
        assert_eq!(
            (f.kind, f.text.as_str(), f.end),
            (SegmentKind::Final, "good evening", secs(2.0))
        );
        assert!(u.finish().is_none());
    }

    #[test]
    fn silence_alone_produces_nothing() {
        let mut u = Utterance::default();
        assert!(u.update("", secs(0.0), secs(2.0), false).is_none());
        assert!(u.update("   ", secs(2.0), secs(2.3), true).is_none());
    }

    #[test]
    fn a_long_intervention_is_closed_without_waiting_for_a_pause() {
        let mut u = Utterance::default();
        assert_eq!(
            u.update("one two three", secs(0.0), secs(2.0), false)
                .unwrap()
                .kind,
            SegmentKind::Partial
        );
        let f = u
            .update("three four five", secs(6.5), secs(8.5), false)
            .unwrap();
        assert_eq!(f.kind, SegmentKind::Final);
        assert_eq!(f.text, "one two three four five");
        // La siguiente ventana empieza una intervención nueva.
        let next = u.update("six seven", secs(8.0), secs(10.0), false).unwrap();
        assert_eq!(
            (next.kind, next.text.as_str()),
            (SegmentKind::Partial, "six seven")
        );
        assert_eq!(next.start, secs(8.0));
    }

    #[test]
    fn whitespace_is_normalized() {
        let mut u = Utterance::default();
        let s = u
            .update("  hello \n  world ", secs(0.0), secs(1.0), true)
            .unwrap();
        assert_eq!(s.text, "hello world");
    }
}
