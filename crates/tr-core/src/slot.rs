//! Buzón de un solo elemento con semántica "último gana".

use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};

struct State<T> {
    value: Option<T>,
    closed: bool,
}

/// El productor sobrescribe sin bloquearse; el consumidor recibe siempre lo más reciente.
/// Pensado para frames y audio donde procesar un valor viejo no aporta nada.
pub struct LatestSlot<T> {
    state: Mutex<State<T>>,
    ready: Condvar,
}

impl<T> Default for LatestSlot<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> LatestSlot<T> {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(State {
                value: None,
                closed: false,
            }),
            ready: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State<T>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Deposita un valor y devuelve el que reemplazó, si el consumidor no lo había tomado.
    /// Tras `close` el valor se descarta.
    pub fn put(&self, value: T) -> Option<T> {
        let mut state = self.lock();
        if state.closed {
            return None;
        }
        let replaced = state.value.replace(value);
        drop(state);
        self.ready.notify_one();
        replaced
    }

    /// Toma el valor si hay uno, sin esperar.
    pub fn try_take(&self) -> Option<T> {
        self.lock().value.take()
    }

    /// Espera hasta que haya un valor. Devuelve `None` cuando el buzón se cerró y está vacío.
    pub fn take(&self) -> Option<T> {
        let mut state = self.lock();
        loop {
            if let Some(value) = state.value.take() {
                return Some(value);
            }
            if state.closed {
                return None;
            }
            state = self
                .ready
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    /// Como [`take`](Self::take) pero espera como máximo `timeout`; devuelve `None` si vence
    /// o si el buzón se cerró.
    pub fn take_timeout(&self, timeout: std::time::Duration) -> Option<T> {
        let deadline = std::time::Instant::now() + timeout;
        let mut state = self.lock();
        loop {
            if let Some(value) = state.value.take() {
                return Some(value);
            }
            let remaining = deadline.checked_duration_since(std::time::Instant::now())?;
            if state.closed || remaining.is_zero() {
                return None;
            }
            state = self
                .ready
                .wait_timeout(state, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    /// Cierra el buzón: descarta lo pendiente y despierta a quien espera.
    pub fn close(&self) {
        let mut state = self.lock();
        state.closed = true;
        state.value = None;
        drop(state);
        self.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn consumer_gets_only_the_latest_value() {
        let slot = LatestSlot::new();
        assert_eq!(slot.put(1), None);
        assert_eq!(slot.put(2), Some(1));
        assert_eq!(slot.put(3), Some(2));
        assert_eq!(slot.take(), Some(3));
        assert_eq!(slot.try_take(), None);
    }

    #[test]
    fn producer_never_blocks_without_a_consumer() {
        let slot = LatestSlot::new();
        for i in 0..10_000 {
            slot.put(i);
        }
        assert_eq!(slot.try_take(), Some(9_999));
    }

    #[test]
    fn take_waits_for_a_value() {
        let slot = Arc::new(LatestSlot::new());
        let consumer = {
            let slot = Arc::clone(&slot);
            thread::spawn(move || slot.take())
        };
        thread::sleep(Duration::from_millis(30));
        slot.put("late");
        assert_eq!(consumer.join().unwrap(), Some("late"));
    }

    #[test]
    fn take_timeout_returns_none_when_nothing_arrives() {
        let slot = LatestSlot::<u8>::new();
        let started = std::time::Instant::now();
        assert_eq!(slot.take_timeout(Duration::from_millis(30)), None);
        assert!(started.elapsed() >= Duration::from_millis(25));
        slot.put(7);
        assert_eq!(slot.take_timeout(Duration::from_millis(30)), Some(7));
    }

    #[test]
    fn close_wakes_waiters_and_drops_pending() {
        let slot = Arc::new(LatestSlot::<u8>::new());
        let consumer = {
            let slot = Arc::clone(&slot);
            thread::spawn(move || slot.take())
        };
        thread::sleep(Duration::from_millis(30));
        slot.close();
        assert_eq!(consumer.join().unwrap(), None);
        assert_eq!(slot.put(1), None);
        assert_eq!(slot.take(), None);
    }

    #[test]
    fn slow_consumer_skips_intermediate_values() {
        let slot = Arc::new(LatestSlot::new());
        let consumer = {
            let slot = Arc::clone(&slot);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(50));
                slot.take()
            })
        };
        for i in 0..100 {
            slot.put(i);
        }
        assert_eq!(consumer.join().unwrap(), Some(99));
    }
}
