//! Detección de cambio entre frames, barata y sin dependencias.
//!
//! Cada frame se reduce a una cuadrícula de luminancia (promedio por bloque) y se compara
//! con la última cuadrícula aceptada mediante la diferencia media absoluta (0..=255).

use crate::types::Frame;

#[derive(Debug, Clone, Copy)]
pub struct ChangeConfig {
    /// Celdas por lado de la cuadrícula.
    pub grid: u32,
    /// Diferencia media absoluta por encima de la cual se considera que hay cambio.
    pub threshold: f32,
}

impl Default for ChangeConfig {
    fn default() -> Self {
        Self {
            grid: 32,
            threshold: 2.0,
        }
    }
}

struct Signature {
    width: u32,
    height: u32,
    cells: Vec<u8>,
}

pub struct ChangeDetector {
    config: ChangeConfig,
    last: Option<Signature>,
}

impl ChangeDetector {
    pub fn new(config: ChangeConfig) -> Self {
        Self { config, last: None }
    }

    /// `true` si el frame difiere lo suficiente del último frame aceptado (el primero
    /// siempre cuenta como cambio). Solo se actualiza la referencia cuando hay cambio,
    /// de modo que una deriva lenta termina detectándose.
    pub fn changed(&mut self, frame: &Frame) -> bool {
        let signature = self.signature(frame);
        let changed = match &self.last {
            None => true,
            Some(prev) => {
                prev.width != signature.width
                    || prev.height != signature.height
                    || mean_abs_diff(&prev.cells, &signature.cells) > self.config.threshold
            }
        };
        if changed {
            self.last = Some(signature);
        }
        changed
    }

    /// Olvida la referencia: el siguiente frame se tratará como cambio.
    pub fn reset(&mut self) {
        self.last = None;
    }

    fn signature(&self, frame: &Frame) -> Signature {
        let gx = self.config.grid.clamp(1, frame.width) as usize;
        let gy = self.config.grid.clamp(1, frame.height) as usize;
        let (w, h) = (frame.width as usize, frame.height as usize);
        let mut cells = Vec::with_capacity(gx * gy);
        for cy in 0..gy {
            let (y0, y1) = (cy * h / gy, (cy + 1) * h / gy);
            for cx in 0..gx {
                let (x0, x1) = (cx * w / gx, (cx + 1) * w / gx);
                let mut sum = 0u64;
                for y in y0..y1 {
                    let row = &frame.rgba[(y * w + x0) * 4..(y * w + x1) * 4];
                    for px in row.as_chunks::<4>().0 {
                        sum += (u64::from(px[0]) * 299
                            + u64::from(px[1]) * 587
                            + u64::from(px[2]) * 114)
                            / 1000;
                    }
                }
                let count = ((y1 - y0) * (x1 - x0)) as u64;
                cells.push((sum / count.max(1)) as u8);
            }
        }
        Signature {
            width: frame.width,
            height: frame.height,
            cells,
        }
    }
}

fn mean_abs_diff(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return f32::MAX;
    }
    let total: u64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| u64::from(x.abs_diff(*y)))
        .sum();
    total as f32 / a.len() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detector() -> ChangeDetector {
        ChangeDetector::new(ChangeConfig {
            grid: 8,
            threshold: 2.0,
        })
    }

    #[test]
    fn first_frame_counts_as_change() {
        assert!(detector().changed(&Frame::solid(64, 64, 10)));
    }

    #[test]
    fn identical_frames_are_not_a_change() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(64, 64, 10)));
        assert!(!d.changed(&Frame::solid(64, 64, 10)));
        assert!(!d.changed(&Frame::solid(64, 64, 10)));
    }

    #[test]
    fn noise_below_threshold_is_ignored() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(64, 64, 100)));
        assert!(!d.changed(&Frame::solid(64, 64, 101)));
    }

    #[test]
    fn change_above_threshold_is_detected() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(64, 64, 100)));
        assert!(d.changed(&Frame::solid(64, 64, 110)));
        assert!(!d.changed(&Frame::solid(64, 64, 110)));
    }

    #[test]
    fn localized_change_is_detected() {
        let mut d = ChangeDetector::new(ChangeConfig {
            grid: 4,
            threshold: 2.0,
        });
        let base = Frame::solid(16, 16, 0);
        assert!(d.changed(&base));
        let mut lit = base.clone();
        // Bloque superior izquierdo (cuarta parte de lado) en blanco.
        for y in 0..4 {
            for x in 0..4 {
                let i = (y * 16 + x) * 4;
                lit.rgba[i..i + 3].fill(255);
            }
        }
        assert!(d.changed(&lit));
    }

    #[test]
    fn slow_drift_is_eventually_detected() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(64, 64, 100)));
        assert!(!d.changed(&Frame::solid(64, 64, 101)));
        assert!(!d.changed(&Frame::solid(64, 64, 102)));
        assert!(d.changed(&Frame::solid(64, 64, 103)));
    }

    #[test]
    fn size_change_counts_as_change() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(64, 64, 10)));
        assert!(d.changed(&Frame::solid(32, 32, 10)));
    }

    #[test]
    fn tiny_frames_do_not_panic() {
        let mut d = detector();
        assert!(d.changed(&Frame::solid(1, 1, 5)));
        assert!(!d.changed(&Frame::solid(1, 1, 5)));
    }

    #[test]
    fn reset_forgets_the_reference() {
        let mut d = detector();
        d.changed(&Frame::solid(8, 8, 1));
        d.reset();
        assert!(d.changed(&Frame::solid(8, 8, 1)));
    }
}
