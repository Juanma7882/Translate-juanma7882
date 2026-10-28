//! Parámetros de rendimiento comunes a los motores (Hito 5A, ver `docs/adr/0006-rendimiento.md`).
//!
//! Son números sueltos, sin contenido. Los motores los reciben al cargarse (`load_with`); los
//! constructores sin sufijo usan [`PerfConfig::default`].

/// Afinación de rendimiento de los motores de ML.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerfConfig {
    /// Hilos de cálculo (intra-op) de cada sesión de ONNX Runtime. `0` = automático
    /// ([`auto_threads`]).
    pub intra_threads: usize,
    /// Haces de la búsqueda de la traducción: `1` es voraz, `2..=8` búsqueda por haces.
    pub beam_size: usize,
    /// Lado máximo, en píxeles, con que el OCR *detecta* texto: el frame se reduce a ese lado
    /// antes de detectar (el reconocimiento sigue usando la imagen original). `0` = 4000.
    pub ocr_max_side: u32,
    /// Prioriza la RAM sobre la latencia: el traductor devuelve la memoria de trabajo al
    /// sistema en cada ejecución (el reconocimiento de voz siempre lo hace).
    pub low_memory: bool,
}

/// Haces por defecto: ver las mediciones del ADR 0006.
pub const DEFAULT_BEAM_SIZE: usize = 1;
/// Máximo de haces admitido (más no mejora la calidad y multiplica el coste).
pub const MAX_BEAM_SIZE: usize = 8;
/// Lado máximo de detección por defecto del OCR (el de PaddleOCR).
pub const DEFAULT_OCR_MAX_SIDE: u32 = 960;
/// Tope de hilos automáticos: más hilos por sesión no aceleran estos modelos pequeños.
const MAX_AUTO_THREADS: usize = 4;

impl Default for PerfConfig {
    fn default() -> Self {
        Self {
            intra_threads: 0,
            beam_size: DEFAULT_BEAM_SIZE,
            ocr_max_side: DEFAULT_OCR_MAX_SIDE,
            low_memory: false,
        }
    }
}

impl PerfConfig {
    /// Hilos efectivos por sesión: los pedidos o, en automático, los de [`auto_threads`].
    pub fn threads(&self) -> usize {
        if self.intra_threads == 0 {
            auto_threads()
        } else {
            self.intra_threads
        }
    }

    /// Como [`Self::threads`], pero el valor automático no pasa de `cap`: para motores que no
    /// ganan nada con más hilos (la traducción: 1 hilo rinde lo mismo que 4).
    pub fn threads_capped(&self, cap: usize) -> usize {
        if self.intra_threads == 0 {
            auto_threads().min(cap.max(1))
        } else {
            self.intra_threads
        }
    }

    /// Haces efectivos, acotados a `1..=MAX_BEAM_SIZE`.
    pub fn beams(&self) -> usize {
        self.beam_size.clamp(1, MAX_BEAM_SIZE)
    }
}

/// Hilos automáticos: la mitad de los núcleos lógicos (los modelos son pequeños y el resto de la
/// máquina, y la UI, necesitan CPU), entre 1 y 4.
pub fn auto_threads() -> usize {
    std::thread::available_parallelism()
        .map_or(2, |n| n.get() / 2)
        .clamp(1, MAX_AUTO_THREADS)
}

/// Crea una sesión de ONNX Runtime con los ajustes comunes: `threads` hilos de cálculo, un solo
/// hilo entre operadores y sin espera activa (los hilos ociosos duermen en vez de girar).
/// `arena = false` desactiva el arena de memoria de la CPU: la memoria que ONNX Runtime reserva
/// para activaciones se devuelve al sistema en cada ejecución en vez de quedarse retenida
/// (menos RAM a cambio de algo más de latencia).
#[cfg(any(feature = "translate-opus", feature = "stt-whisper"))]
pub(crate) fn session(
    path: &std::path::Path,
    threads: usize,
    arena: bool,
) -> tr_core::Result<ort::session::Session> {
    let build = || -> ort::Result<ort::session::Session> {
        let builder = ort::session::Session::builder()?
            .with_intra_threads(threads.max(1))?
            .with_inter_threads(1)?
            .with_intra_op_spinning(false)?;
        let mut builder = if arena {
            builder
        } else {
            builder
                .with_memory_pattern(false)?
                .with_execution_providers([ort::ep::CPU::default()
                    .with_arena_allocator(false)
                    .build()])?
        };
        builder.commit_from_file(path)
    };
    build()
        .map_err(|e| tr_core::CoreError::Model(format!("could not load `{}`: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_threads_stay_between_one_and_four() {
        assert!((1..=4).contains(&auto_threads()));
        assert_eq!(PerfConfig::default().threads(), auto_threads());
    }

    #[test]
    fn explicit_threads_win_over_automatic() {
        let config = PerfConfig {
            intra_threads: 3,
            ..PerfConfig::default()
        };
        assert_eq!(config.threads(), 3);
    }

    #[test]
    fn the_cap_only_limits_the_automatic_value() {
        let auto = PerfConfig::default();
        assert_eq!(auto.threads_capped(1), 1);
        assert!(auto.threads_capped(2) <= 2);
        let explicit = PerfConfig {
            intra_threads: 4,
            ..auto
        };
        assert_eq!(explicit.threads_capped(1), 4);
    }

    #[test]
    fn beams_are_clamped() {
        let beams = |n| {
            PerfConfig {
                beam_size: n,
                ..PerfConfig::default()
            }
            .beams()
        };
        assert_eq!((beams(0), beams(1), beams(4), beams(99)), (1, 1, 4, 8));
    }
}
