//! Agrupa muestras mono a 16 kHz en trozos de duración fija con su instante de inicio.

use std::time::Duration;

use tr_core::ports::ChunkCallback;
use tr_core::{AudioChunk, types::SAMPLE_RATE};

/// 100 ms de audio por trozo: suficiente resolución para el VAD sin saturar el canal.
pub const CHUNK_SAMPLES: usize = SAMPLE_RATE as usize / 10;

pub struct Chunker {
    on_chunk: ChunkCallback,
    pending: Vec<f32>,
    emitted: usize,
}

impl Chunker {
    pub fn new(on_chunk: ChunkCallback) -> Self {
        Self {
            on_chunk,
            pending: Vec::with_capacity(CHUNK_SAMPLES * 2),
            emitted: 0,
        }
    }

    /// Añade muestras y entrega todos los trozos completos.
    pub fn push(&mut self, samples: &[f32]) {
        self.pending.extend_from_slice(samples);
        let mut offset = 0;
        while self.pending.len() - offset >= CHUNK_SAMPLES {
            let samples = self.pending[offset..offset + CHUNK_SAMPLES].to_vec();
            let start = Duration::from_secs_f64(self.emitted as f64 / f64::from(SAMPLE_RATE));
            self.emitted += CHUNK_SAMPLES;
            offset += CHUNK_SAMPLES;
            (self.on_chunk)(AudioChunk::new(samples, start));
        }
        self.pending.drain(..offset);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    fn collect() -> (Chunker, Arc<Mutex<Vec<AudioChunk>>>) {
        let out = Arc::new(Mutex::new(Vec::new()));
        let sink = out.clone();
        let chunker = Chunker::new(Box::new(move |c| sink.lock().unwrap().push(c)));
        (chunker, out)
    }

    #[test]
    fn full_chunks_are_delivered_with_consecutive_start_times() {
        let (mut chunker, out) = collect();
        chunker.push(&vec![0.5; CHUNK_SAMPLES * 2 + 10]);
        let chunks = out.lock().unwrap();
        assert_eq!(chunks.len(), 2);
        assert!(chunks.iter().all(|c| c.samples.len() == CHUNK_SAMPLES));
        assert_eq!(chunks[0].start, Duration::ZERO);
        assert_eq!(chunks[1].start, Duration::from_millis(100));
    }

    #[test]
    fn leftovers_wait_for_more_samples_and_nothing_is_lost() {
        let (mut chunker, out) = collect();
        for _ in 0..7 {
            chunker.push(&[0.25; 400]);
        }
        let chunks = out.lock().unwrap();
        assert_eq!(chunks.len(), 1, "2800 muestras = 1 trozo y 1200 en espera");
        assert_eq!(chunks[0].samples.len(), CHUNK_SAMPLES);
    }

    #[test]
    fn empty_pushes_do_nothing() {
        let (mut chunker, out) = collect();
        chunker.push(&[]);
        assert!(out.lock().unwrap().is_empty());
    }
}
