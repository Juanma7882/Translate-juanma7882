//! Caché de traducciones en RAM. Nunca se persiste.
//!
//! Lleva contadores de aciertos y fallos (solo números, jamás texto) para medir si sirve.

use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use lru::LruCache;

use crate::types::Lang;

type Key = (String, Lang, Lang);

pub const DEFAULT_CAPACITY: usize = 256;

/// Los textos más largos que esto (en caracteres) no se guardan: es OCR basura o un párrafo que
/// casi nunca se repite, y cada entrada ocuparía mucha RAM.
pub const MAX_CACHED_CHARS: usize = 2000;

/// Contadores de una caché desde que se creó (o desde el último [`TranslationCache::clear`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub inserts: u64,
    /// Entradas descartadas por haberse llenado la caché.
    pub evictions: u64,
}

impl CacheStats {
    /// Fracción de consultas que acertaron (0 si aún no hubo ninguna).
    pub fn hit_ratio(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f64 / total as f64
        }
    }
}

/// LRU acotado con clave `(texto normalizado, origen, destino)`: minúsculas y espacios
/// colapsados, de modo que variaciones triviales del OCR acierten la misma entrada.
pub struct TranslationCache {
    inner: Mutex<LruCache<Key, String>>,
    hits: AtomicU64,
    misses: AtomicU64,
    inserts: AtomicU64,
    evictions: AtomicU64,
}

impl TranslationCache {
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::MIN);
        Self {
            inner: Mutex::new(LruCache::new(capacity)),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            inserts: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, LruCache<Key, String>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn key(text: &str, from: &Lang, to: &Lang) -> Key {
        let normalized = text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        (normalized, from.clone(), to.clone())
    }

    pub fn get(&self, text: &str, from: &Lang, to: &Lang) -> Option<String> {
        let found = self.lock().get(&Self::key(text, from, to)).cloned();
        let counter = if found.is_some() {
            &self.hits
        } else {
            &self.misses
        };
        counter.fetch_add(1, Ordering::Relaxed);
        found
    }

    pub fn insert(&self, text: &str, from: &Lang, to: &Lang, translation: String) {
        if text.chars().count() > MAX_CACHED_CHARS {
            return;
        }
        let key = Self::key(text, from, to);
        let replaced = self.lock().push(key.clone(), translation);
        self.inserts.fetch_add(1, Ordering::Relaxed);
        // `push` devuelve la entrada vieja de la misma clave (reemplazo) o la desalojada.
        if replaced.is_some_and(|(old, _)| old != key) {
            self.evictions.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Entradas que caben como máximo.
    pub fn capacity(&self) -> usize {
        self.lock().cap().get()
    }

    /// Vacía la caché y pone los contadores a cero.
    pub fn clear(&self) {
        self.lock().clear();
        for counter in [&self.hits, &self.misses, &self.inserts, &self.evictions] {
            counter.store(0, Ordering::Relaxed);
        }
    }

    /// Contadores actuales.
    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            inserts: self.inserts.load(Ordering::Relaxed),
            evictions: self.evictions.load(Ordering::Relaxed),
        }
    }
}

impl Default for TranslationCache {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lang(code: &str) -> Lang {
        Lang::new(code).unwrap()
    }

    #[test]
    fn hit_and_miss() {
        let cache = TranslationCache::new(4);
        let (en, es) = (lang("en"), lang("es"));
        assert_eq!(cache.get("hello", &en, &es), None);
        cache.insert("hello", &en, &es, "hola".into());
        assert_eq!(cache.get("hello", &en, &es), Some("hola".into()));
        assert_eq!(
            cache.get("Hello", &en, &es),
            Some("hola".into()),
            "clave sin distinguir mayúsculas"
        );
    }

    #[test]
    fn language_pair_is_part_of_the_key() {
        let cache = TranslationCache::new(4);
        let (en, es, fr) = (lang("en"), lang("es"), lang("fr"));
        cache.insert("hello", &en, &es, "hola".into());
        cache.insert("hello", &en, &fr, "bonjour".into());
        assert_eq!(cache.get("hello", &en, &es), Some("hola".into()));
        assert_eq!(cache.get("hello", &en, &fr), Some("bonjour".into()));
        assert_eq!(cache.get("hello", &es, &en), None);
    }

    #[test]
    fn least_recently_used_entry_is_evicted() {
        let cache = TranslationCache::new(2);
        let (en, es) = (lang("en"), lang("es"));
        cache.insert("a", &en, &es, "A".into());
        cache.insert("b", &en, &es, "B".into());
        assert!(cache.get("a", &en, &es).is_some()); // "b" pasa a ser el menos reciente
        cache.insert("c", &en, &es, "C".into());
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get("b", &en, &es), None);
        assert!(cache.get("a", &en, &es).is_some());
        assert!(cache.get("c", &en, &es).is_some());
    }

    #[test]
    fn zero_capacity_is_clamped_to_one() {
        let cache = TranslationCache::new(0);
        let (en, es) = (lang("en"), lang("es"));
        cache.insert("a", &en, &es, "A".into());
        cache.insert("b", &en, &es, "B".into());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn clear_empties_the_cache() {
        let cache = TranslationCache::default();
        let (en, es) = (lang("en"), lang("es"));
        cache.insert("a", &en, &es, "A".into());
        cache.clear();
        assert!(cache.is_empty());
    }

    #[test]
    fn whitespace_variations_hit_the_same_entry() {
        let cache = TranslationCache::new(4);
        let (en, es) = (lang("en"), lang("es"));
        cache.insert(
            "Press  any
button",
            &en,
            &es,
            "pulsa".into(),
        );
        assert_eq!(
            cache.get(" press any button ", &en, &es),
            Some("pulsa".into())
        );
    }

    #[test]
    fn counters_track_hits_misses_inserts_and_evictions() {
        let cache = TranslationCache::new(2);
        let (en, es) = (lang("en"), lang("es"));
        assert_eq!(cache.stats(), CacheStats::default());
        assert_eq!(cache.get("a", &en, &es), None);
        cache.insert("a", &en, &es, "A".into());
        cache.insert("a", &en, &es, "A2".into()); // reemplazo: no es desalojo
        cache.insert("b", &en, &es, "B".into());
        cache.insert("c", &en, &es, "C".into()); // desaloja "a"
        assert!(cache.get("c", &en, &es).is_some());
        assert_eq!(
            cache.stats(),
            CacheStats {
                hits: 1,
                misses: 1,
                inserts: 4,
                evictions: 1
            }
        );
        assert!((cache.stats().hit_ratio() - 0.5).abs() < f64::EPSILON);
        cache.clear();
        assert_eq!(cache.stats(), CacheStats::default());
        assert_eq!(cache.stats().hit_ratio(), 0.0);
    }

    #[test]
    fn huge_texts_are_not_cached_and_capacity_is_reported() {
        let cache = TranslationCache::new(8);
        let (en, es) = (lang("en"), lang("es"));
        assert_eq!(cache.capacity(), 8);
        cache.insert(&"x".repeat(MAX_CACHED_CHARS + 1), &en, &es, "y".into());
        assert!(cache.is_empty());
        cache.insert(&"x".repeat(MAX_CACHED_CHARS), &en, &es, "y".into());
        assert_eq!(cache.len(), 1);
    }
}
