//! Traducción de un texto a uno o dos destinos a la vez.
//!
//! Cada destino tiene su propio [`Translator`] (un modelo cargado para ese par). Con dos destinos
//! se traducen en paralelo, de modo que el texto aparece cuando termina el más lento y no cuando
//! terminan los dos en serie. Con uno (o ninguno) no se crea ningún hilo.

use std::sync::Arc;
use std::thread;

use crate::cache::TranslationCache;
use crate::error::CoreError;
use crate::ports::Translator;
use crate::types::{Lang, Translated};

/// Máximo de destinos por sesión: el original cuenta como un subtítulo y hay como mucho dos.
pub const MAX_TARGETS: usize = 2;

/// Un idioma de destino y el traductor que lo produce.
#[derive(Clone)]
pub struct Target {
    pub lang: Lang,
    pub translator: Arc<dyn Translator>,
}

impl Target {
    pub fn new(lang: Lang, translator: Arc<dyn Translator>) -> Self {
        Self { lang, translator }
    }
}

/// Resultado de traducir a todos los destinos.
#[derive(Debug, Default)]
pub struct TranslateOutcome {
    /// Las traducciones logradas, en el orden de los destinos.
    pub translations: Vec<Translated>,
    /// Un error por cada destino que falló.
    pub errors: Vec<CoreError>,
}

fn translate_one(
    target: &Target,
    from: &Lang,
    text: &str,
    cache: &TranslationCache,
) -> Result<Translated, CoreError> {
    let lang = target.lang.clone();
    if let Some(hit) = cache.get(text, from, &lang) {
        return Ok(Translated { lang, text: hit });
    }
    let translation = target.translator.translate(text, from, &lang)?;
    cache.insert(text, from, &lang, translation.clone());
    Ok(Translated {
        lang,
        text: translation,
    })
}

/// Traduce `text` a todos los `targets`. Los destinos se procesan a la vez cuando hay más de uno;
/// el resultado conserva el orden de `targets` y un fallo (o un pánico) de uno no pierde el otro.
pub fn translate_all(
    targets: &[Target],
    from: &Lang,
    text: &str,
    cache: &TranslationCache,
) -> TranslateOutcome {
    let results: Vec<Result<Translated, CoreError>> = match targets {
        [] => Vec::new(),
        [only] => vec![translate_one(only, from, text, cache)],
        many => thread::scope(|scope| {
            let handles: Vec<_> = many
                .iter()
                .map(|target| scope.spawn(move || translate_one(target, from, text, cache)))
                .collect();
            handles
                .into_iter()
                .map(|handle| {
                    handle.join().unwrap_or_else(|_| {
                        Err(CoreError::Translation("translation panicked".into()))
                    })
                })
                .collect()
        }),
    };
    let mut outcome = TranslateOutcome::default();
    for result in results {
        match result {
            Ok(translated) => outcome.translations.push(translated),
            Err(error) => outcome.errors.push(error),
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::FakeTranslator;
    use std::time::{Duration, Instant};

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    fn target(code: &str, translator: &FakeTranslator) -> Target {
        Target::new(lang(code), Arc::new(translator.clone()))
    }

    fn texts(outcome: &TranslateOutcome) -> Vec<(String, String)> {
        outcome
            .translations
            .iter()
            .map(|t| (t.lang.to_string(), t.text.clone()))
            .collect()
    }

    #[test]
    fn no_targets_does_not_call_any_translator() {
        let cache = TranslationCache::default();
        let outcome = translate_all(&[], &lang("en"), "hello", &cache);
        assert!(outcome.translations.is_empty() && outcome.errors.is_empty());
    }

    #[test]
    fn one_target_translates_and_caches() {
        let (translator, cache) = (FakeTranslator::new(), TranslationCache::default());
        translator.add("hello", "hola");
        let targets = [target("es", &translator)];
        for _ in 0..2 {
            let outcome = translate_all(&targets, &lang("en"), "hello", &cache);
            assert_eq!(texts(&outcome), [("es".into(), "hola".into())]);
        }
        assert_eq!(translator.call_count(), 1, "la segunda sale de la caché");
    }

    #[test]
    fn two_targets_keep_the_order_of_the_targets() {
        let (es, fr, cache) = (
            FakeTranslator::new(),
            FakeTranslator::new(),
            TranslationCache::default(),
        );
        // El primero tarda más: aun así debe quedar primero.
        es.set_latency(Duration::from_millis(80));
        es.add("hello", "hola");
        fr.add("hello", "bonjour");
        let targets = [target("es", &es), target("fr", &fr)];
        let outcome = translate_all(&targets, &lang("en"), "hello", &cache);
        assert_eq!(
            texts(&outcome),
            [
                ("es".into(), "hola".into()),
                ("fr".into(), "bonjour".into())
            ]
        );
    }

    #[test]
    fn two_targets_run_at_the_same_time() {
        let (es, fr, cache) = (
            FakeTranslator::new(),
            FakeTranslator::new(),
            TranslationCache::default(),
        );
        es.set_latency(Duration::from_millis(250));
        fr.set_latency(Duration::from_millis(250));
        let targets = [target("es", &es), target("fr", &fr)];
        let start = Instant::now();
        let outcome = translate_all(&targets, &lang("en"), "hello", &cache);
        let elapsed = start.elapsed();
        assert_eq!(outcome.translations.len(), 2);
        // En serie serían >= 500 ms; en paralelo, cerca de 250 ms.
        assert!(
            elapsed < Duration::from_millis(450),
            "tardó {elapsed:?}: no corrió en paralelo"
        );
    }

    #[test]
    fn a_failing_target_does_not_lose_the_other() {
        let (es, fr, cache) = (
            FakeTranslator::new(),
            FakeTranslator::new(),
            TranslationCache::default(),
        );
        fr.fail_next(CoreError::Translation("offline".into()));
        let targets = [target("es", &es), target("fr", &fr)];
        let outcome = translate_all(&targets, &lang("en"), "hello", &cache);
        assert_eq!(texts(&outcome), [("es".into(), "[es] hello".into())]);
        assert_eq!(outcome.errors.len(), 1);
    }

    struct Panicking;
    impl Translator for Panicking {
        fn translate(&self, _: &str, _: &Lang, _: &Lang) -> crate::Result<String> {
            panic!("boom");
        }
    }

    #[test]
    fn a_panicking_target_is_reported_as_an_error() {
        let (es, cache) = (FakeTranslator::new(), TranslationCache::default());
        let targets = [
            target("es", &es),
            Target::new(lang("fr"), Arc::new(Panicking)),
        ];
        let outcome = translate_all(&targets, &lang("en"), "hello", &cache);
        assert_eq!(outcome.translations.len(), 1);
        assert_eq!(outcome.errors.len(), 1);
    }

    #[test]
    fn the_cache_is_per_target() {
        let (es, fr, cache) = (
            FakeTranslator::new(),
            FakeTranslator::new(),
            TranslationCache::default(),
        );
        let targets = [target("es", &es), target("fr", &fr)];
        translate_all(&targets, &lang("en"), "hello", &cache);
        translate_all(&targets, &lang("en"), "hello", &cache);
        assert_eq!((es.call_count(), fr.call_count()), (1, 1));
    }
}
