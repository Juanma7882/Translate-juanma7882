//! Caché de traducciones en RAM. Nunca se persiste.

use std::num::NonZeroUsize;
use std::sync::{Mutex, MutexGuard, PoisonError};

use lru::LruCache;

use crate::types::Lang;

type Key = (String, Lang, Lang);

pub const DEFAULT_CAPACITY: usize = 256;

/// LRU acotado con clave `(texto normalizado en minúsculas, origen, destino)`.
pub struct TranslationCache {
    inner: Mutex<LruCache<Key, String>>,
}

impl TranslationCache {
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::MIN);
        Self {
            inner: Mutex::new(LruCache::new(capacity)),
        }
    }

    fn lock(&self) -> MutexGuard<'_, LruCache<Key, String>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn key(text: &str, from: &Lang, to: &Lang) -> Key {
        (text.to_lowercase(), from.clone(), to.clone())
    }

    pub fn get(&self, text: &str, from: &Lang, to: &Lang) -> Option<String> {
        self.lock().get(&Self::key(text, from, to)).cloned()
    }

    pub fn insert(&self, text: &str, from: &Lang, to: &Lang, translation: String) {
        self.lock().put(Self::key(text, from, to), translation);
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        self.lock().clear();
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
}
