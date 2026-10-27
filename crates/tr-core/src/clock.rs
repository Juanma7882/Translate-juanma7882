//! Reloj real basado en `std::time::Instant`.

use std::time::{Duration, Instant};

use crate::ports::Clock;

pub struct SystemClock {
    origin: Instant,
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Duration {
        self.origin.elapsed()
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_moves_forward_and_sleep_waits() {
        let clock = SystemClock::new();
        let before = clock.now();
        clock.sleep(Duration::from_millis(20));
        assert!(clock.now() - before >= Duration::from_millis(15));
    }
}
