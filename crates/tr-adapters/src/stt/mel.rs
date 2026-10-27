//! Espectrograma log-mel de Whisper (80 bandas, ventana de 30 s), sin dependencias nativas.
//!
//! Reproduce `WhisperFeatureExtractor` de Hugging Face: relleno con ceros hasta 30 s, STFT con
//! ventana de Hann (400 muestras, salto de 160, reflejo en los bordes), potencia, filtros mel de
//! Slaney, `log10` acotado a 8 décadas bajo el máximo y normalización `(x + 4) / 4`.

use std::sync::Arc;

use realfft::{RealFftPlanner, RealToComplex};

pub const SAMPLE_RATE: usize = 16_000;
pub const N_FFT: usize = 400;
pub const HOP: usize = 160;
pub const N_MELS: usize = 80;
/// Duración fija que espera el encoder de Whisper.
pub const CHUNK_SECONDS: usize = 30;
pub const N_SAMPLES: usize = CHUNK_SECONDS * SAMPLE_RATE;
/// Cuadros de salida (30 s a 100 cuadros por segundo).
pub const N_FRAMES: usize = N_SAMPLES / HOP;
const N_BINS: usize = N_FFT / 2 + 1;

fn hz_to_mel(hz: f64) -> f64 {
    const MIN_LOG_HZ: f64 = 1000.0;
    const MIN_LOG_MEL: f64 = 15.0;
    let log_step = 6.4f64.ln() / 27.0;
    if hz >= MIN_LOG_HZ {
        MIN_LOG_MEL + (hz / MIN_LOG_HZ).ln() / log_step
    } else {
        3.0 * hz / 200.0
    }
}

fn mel_to_hz(mel: f64) -> f64 {
    const MIN_LOG_HZ: f64 = 1000.0;
    const MIN_LOG_MEL: f64 = 15.0;
    let log_step = 6.4f64.ln() / 27.0;
    if mel >= MIN_LOG_MEL {
        MIN_LOG_HZ * (log_step * (mel - MIN_LOG_MEL)).exp()
    } else {
        200.0 * mel / 3.0
    }
}

/// Filtros triangulares mel (escala y normalización de Slaney): `N_MELS` filas de `N_BINS`.
fn mel_filters() -> Vec<f32> {
    let fft_freqs: Vec<f64> = (0..N_BINS)
        .map(|i| i as f64 * (SAMPLE_RATE as f64 / 2.0) / (N_BINS - 1) as f64)
        .collect();
    let (low, high) = (hz_to_mel(0.0), hz_to_mel(SAMPLE_RATE as f64 / 2.0));
    let points: Vec<f64> = (0..N_MELS + 2)
        .map(|i| mel_to_hz(low + (high - low) * i as f64 / (N_MELS + 1) as f64))
        .collect();
    let mut filters = vec![0f32; N_MELS * N_BINS];
    for m in 0..N_MELS {
        let (left, center, right) = (points[m], points[m + 1], points[m + 2]);
        let norm = 2.0 / (right - left);
        for (bin, &freq) in fft_freqs.iter().enumerate() {
            let down = (freq - left) / (center - left);
            let up = (right - freq) / (right - center);
            filters[m * N_BINS + bin] = (down.min(up).max(0.0) * norm) as f32;
        }
    }
    filters
}

/// Calculadora reutilizable (los filtros y la ventana se preparan una vez).
pub struct LogMel {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    filters: Vec<f32>,
}

impl Default for LogMel {
    fn default() -> Self {
        Self::new()
    }
}

impl LogMel {
    pub fn new() -> Self {
        let window = (0..N_FFT)
            .map(|i| {
                let phase = 2.0 * std::f64::consts::PI * i as f64 / N_FFT as f64;
                (0.5 - 0.5 * phase.cos()) as f32
            })
            .collect();
        Self {
            fft: RealFftPlanner::<f32>::new().plan_fft_forward(N_FFT),
            window,
            filters: mel_filters(),
        }
    }

    /// Log-mel de hasta 30 s de audio: `N_MELS * N_FRAMES` valores, banda por banda (`[mel][cuadro]`).
    /// Lo que excede 30 s se descarta; lo que falta se rellena con silencio.
    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let samples = &samples[..samples.len().min(N_SAMPLES)];
        // Solo los cuadros que tocan audio real; el resto es silencio exacto (potencia 0).
        let active = (samples.len() / HOP + 2).min(N_FRAMES);
        let last = samples.len() as isize - 1;
        // Reflejo en el borde inicial; tras el final real, relleno de ceros.
        let sample_at = |index: isize| -> f32 {
            if last < 0 || index > last {
                return 0.0;
            }
            samples[index.unsigned_abs()]
        };

        let mut mel = vec![0f32; N_MELS * N_FRAMES];
        let mut input = vec![0f32; N_FFT];
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut power = vec![0f32; N_BINS];
        for frame in 0..active {
            let start = (frame * HOP) as isize - (N_FFT / 2) as isize;
            for (i, value) in input.iter_mut().enumerate() {
                *value = sample_at(start + i as isize) * self.window[i];
            }
            if self
                .fft
                .process_with_scratch(&mut input, &mut spectrum, &mut scratch)
                .is_err()
            {
                continue;
            }
            for (p, c) in power.iter_mut().zip(&spectrum) {
                *p = c.re * c.re + c.im * c.im;
            }
            for m in 0..N_MELS {
                let row = &self.filters[m * N_BINS..(m + 1) * N_BINS];
                let sum: f32 = row.iter().zip(&power).map(|(f, p)| f * p).sum();
                mel[m * N_FRAMES + frame] = sum;
            }
        }

        let mut max = f32::MIN;
        for value in &mut mel {
            *value = value.max(1e-10).log10();
            max = max.max(*value);
        }
        let floor = max - 8.0;
        for value in &mut mel {
            *value = (value.max(floor) + 4.0) / 4.0;
        }
        mel
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mel_scale_round_trips_and_matches_known_points() {
        for hz in [0.0, 100.0, 999.0, 1000.0, 4000.0, 8000.0] {
            assert!((mel_to_hz(hz_to_mel(hz)) - hz).abs() < 1e-6, "{hz}");
        }
        assert!((hz_to_mel(1000.0) - 15.0).abs() < 1e-9);
    }

    #[test]
    fn filters_have_the_expected_shape_and_are_non_negative() {
        let filters = mel_filters();
        assert_eq!(filters.len(), N_MELS * N_BINS);
        assert!(filters.iter().all(|&f| f >= 0.0));
        for m in 0..N_MELS {
            let row = &filters[m * N_BINS..(m + 1) * N_BINS];
            assert!(row.iter().any(|&f| f > 0.0), "la banda {m} está vacía");
        }
    }

    #[test]
    fn output_has_a_fixed_size_whatever_the_input() {
        let mel = LogMel::new();
        assert_eq!(mel.compute(&[]).len(), N_MELS * N_FRAMES);
        assert_eq!(mel.compute(&[0.1; 1600]).len(), N_MELS * N_FRAMES);
        assert_eq!(
            mel.compute(&vec![0.1; N_SAMPLES + 5000]).len(),
            N_MELS * N_FRAMES
        );
    }

    #[test]
    fn silence_is_flat_and_values_stay_in_range() {
        let out = LogMel::new().compute(&vec![0.0; 8000]);
        assert!(out.iter().all(|v| (v - out[0]).abs() < 1e-6));
        let tone: Vec<f32> = (0..16_000)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 16_000.0).sin() * 0.5)
            .collect();
        let out = LogMel::new().compute(&tone);
        let (min, max) = out
            .iter()
            .fold((f32::MAX, f32::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
        assert!(max > min, "min {min}, max {max}");
        assert!(max - min <= 2.0 + 1e-3, "rango dinámico de 8 décadas / 4");
    }

    #[test]
    fn a_tone_lights_the_mel_band_that_contains_it() {
        let tone: Vec<f32> = (0..16_000)
            .map(|i| (i as f32 * 1000.0 * std::f32::consts::TAU / 16_000.0).sin() * 0.5)
            .collect();
        let out = LogMel::new().compute(&tone);
        let frame = 50; // en pleno tono
        let (peak, _) =
            (0..N_MELS)
                .map(|m| (m, out[m * N_FRAMES + frame]))
                .fold(
                    (0, f32::MIN),
                    |best, cur| if cur.1 > best.1 { cur } else { best },
                );
        // 1000 Hz cae en la banda ~ 28-30 de 80 en la escala de Slaney.
        assert!((26..=32).contains(&peak), "pico en la banda {peak}");
    }
}
