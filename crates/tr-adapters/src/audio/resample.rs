//! Conversión a mono y remuestreo a 16 kHz (sinc con ventana, en streaming).

use tr_core::types::SAMPLE_RATE;

/// Semianchura del filtro en cruces por cero (a escala de salida).
const HALF_WIDTH: f64 = 12.0;

/// Mezcla `channels` canales entrelazados en uno (media). Los restos incompletos se ignoran.
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Remuestreador continuo de mono `in_rate` a [`SAMPLE_RATE`]. El estado entre llamadas hace que
/// el resultado no dependa de cómo se parta la entrada.
pub struct Resampler {
    /// Muestras de entrada por muestra de salida.
    step: f64,
    /// Escala del filtro: >1 al reducir la frecuencia (el corte baja con ella).
    scale: f64,
    /// Entrada retenida; `buf[0]` es la muestra absoluta `base`.
    buf: Vec<f32>,
    base: usize,
    /// Posición absoluta (en muestras de entrada) de la próxima salida.
    position: f64,
    passthrough: bool,
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

impl Resampler {
    pub fn new(in_rate: u32) -> Self {
        let out = f64::from(SAMPLE_RATE);
        let step = f64::from(in_rate.max(1)) / out;
        Self {
            step,
            scale: step.max(1.0),
            buf: Vec::new(),
            base: 0,
            position: 0.0,
            passthrough: in_rate == SAMPLE_RATE,
        }
    }

    /// Procesa más entrada y devuelve las muestras de salida ya calculables.
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if self.passthrough {
            return input.to_vec();
        }
        self.buf.extend_from_slice(input);
        let reach = (HALF_WIDTH * self.scale).ceil() as isize;
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 1);
        loop {
            let center = self.position.floor() as isize;
            let last_needed = center + reach;
            if last_needed >= (self.base + self.buf.len()) as isize {
                break;
            }
            let (mut sum, mut weight) = (0.0f64, 0.0f64);
            for i in center - reach + 1..=last_needed {
                let x = (i as f64 - self.position) / self.scale;
                if x.abs() >= HALF_WIDTH {
                    continue;
                }
                let window = 0.5 + 0.5 * (std::f64::consts::PI * x / HALF_WIDTH).cos();
                let w = sinc(x) * window;
                weight += w;
                // Antes del comienzo no hay muestras: cuentan como silencio.
                let index = i - self.base as isize;
                if index >= 0 {
                    sum += w * f64::from(self.buf[index as usize]);
                }
            }
            out.push((sum / weight) as f32);
            self.position += self.step;
        }
        // Descartar lo que ningún filtro futuro volverá a usar.
        let keep_from =
            (self.position.floor() as isize - reach + 1).max(self.base as isize) as usize;
        let drop = (keep_from - self.base).min(self.buf.len());
        self.buf.drain(..drop);
        self.base += drop;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f64, rate: u32, seconds: f64) -> Vec<f32> {
        (0..(f64::from(rate) * seconds) as usize)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    fn zero_crossings(x: &[f32]) -> usize {
        x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count()
    }

    #[test]
    fn mono_mixing_averages_channels_and_drops_partial_frames() {
        assert_eq!(to_mono(&[1.0, 3.0, 2.0, 4.0], 2), [2.0, 3.0]);
        assert_eq!(to_mono(&[1.0, 3.0, 2.0], 2), [2.0]);
        assert_eq!(to_mono(&[0.5, 0.25], 1), [0.5, 0.25]);
    }

    #[test]
    fn the_target_rate_passes_through_unchanged() {
        let mut r = Resampler::new(SAMPLE_RATE);
        assert_eq!(r.process(&[0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
    }

    #[test]
    fn a_tone_keeps_its_frequency_and_level_when_downsampling() {
        for rate in [48_000u32, 44_100, 32_000, 96_000] {
            let out = Resampler::new(rate).process(&tone(1000.0, rate, 1.0));
            let ratio = out.len() as f64 / 16_000.0;
            assert!(
                (0.95..=1.0).contains(&ratio),
                "{rate}: {} muestras",
                out.len()
            );
            let steady = &out[200..out.len() - 200];
            assert!(
                (rms(steady) - 0.707).abs() < 0.02,
                "{rate}: rms {}",
                rms(steady)
            );
            let hz = zero_crossings(steady) as f64 / (steady.len() as f64 / 16_000.0);
            assert!((hz - 1000.0).abs() < 15.0, "{rate}: {hz} Hz");
        }
    }

    #[test]
    fn frequencies_above_the_new_nyquist_are_strongly_attenuated() {
        let out = Resampler::new(48_000).process(&tone(12_000.0, 48_000, 1.0));
        assert!(
            rms(&out[200..out.len() - 200]) < 0.05,
            "no debe colarse como alias"
        );
    }

    #[test]
    fn splitting_the_input_does_not_change_the_output() {
        let input = tone(700.0, 48_000, 0.5);
        let whole = Resampler::new(48_000).process(&input);
        let mut parts = Resampler::new(48_000);
        let mut joined = Vec::new();
        for piece in input.chunks(777) {
            joined.extend(parts.process(piece));
        }
        let n = whole.len().min(joined.len());
        assert!(n > 7000);
        assert!(
            whole[..n]
                .iter()
                .zip(&joined[..n])
                .all(|(a, b)| (a - b).abs() < 1e-5)
        );
    }

    #[test]
    fn memory_stays_bounded_on_long_streams() {
        let mut r = Resampler::new(48_000);
        for _ in 0..100 {
            r.process(&[0.1; 4800]);
        }
        assert!(r.buf.len() < 500, "se retienen {} muestras", r.buf.len());
    }

    #[test]
    fn empty_input_is_fine() {
        assert!(Resampler::new(44_100).process(&[]).is_empty());
    }
}
