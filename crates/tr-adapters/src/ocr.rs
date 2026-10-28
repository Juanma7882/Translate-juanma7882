//! OCR real con PaddleOCR (PP-OCRv6) sobre ONNX Runtime, mediante `oar-ocr`.
//!
//! Los modelos se leen de una carpeta (`det.onnx`, `rec.onnx`, `dict.txt`) y se cargan desde
//! memoria. Nada se escribe a disco y no hay acceso a la red al reconocer.

use std::path::Path;

use image::RgbImage;
use oar_ocr::core::config::OrtSessionConfig;
use oar_ocr::domain::tasks::TextDetectionConfig;
use oar_ocr::prelude::*;
use oar_ocr::processors::LimitType;
use tr_core::{BBox, CoreError, Frame, Lang, OcrEngine, Result, TextBlock};

use crate::perf::PerfConfig;

/// Archivos que debe tener la carpeta del modelo.
pub const MODEL_FILES: [&str; 3] = ["det.onnx", "rec.onnx", "dict.txt"];

fn ocr_error(message: impl Into<String>) -> CoreError {
    CoreError::Ocr(message.into())
}

/// Resultado de una región detectada, independiente de los tipos de `oar-ocr`.
#[derive(Debug, Clone, PartialEq)]
struct Detected {
    text: String,
    confidence: f32,
    /// Vértices del polígono en píxeles de la imagen.
    points: Vec<(f32, f32)>,
}

impl Detected {
    fn bounds(&self) -> Option<(f32, f32, f32, f32)> {
        let first = *self.points.first()?;
        Some(self.points.iter().fold(
            (first.0, first.1, first.0, first.1),
            |(x0, y0, x1, y1), &(x, y)| (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
        ))
    }

    /// Caja delimitadora recortada a la imagen; `None` si el polígono está vacío o fuera.
    fn to_block(&self, width: u32, height: u32) -> Option<TextBlock> {
        let (x0, y0, x1, y1) = self.bounds()?;
        let clamp = |v: f32, max: u32| v.max(0.0).min(max as f32);
        let (x0, y0) = (clamp(x0, width), clamp(y0, height));
        let (x1, y1) = (clamp(x1, width), clamp(y1, height));
        if x1 <= x0 || y1 <= y0 {
            return None;
        }
        Some(TextBlock {
            text: self.text.clone(),
            bbox: BBox {
                x: x0 as u32,
                y: y0 as u32,
                width: (x1 - x0).ceil() as u32,
                height: (y1 - y0).ceil() as u32,
            },
            confidence: self.confidence,
        })
    }
}

/// Orden de lectura: de arriba abajo; dentro de una misma línea, de izquierda a derecha.
/// Dos bloques están en la misma línea si sus centros verticales distan menos de la mitad
/// de la menor altura.
fn reading_order(blocks: &mut [TextBlock]) {
    let center = |b: &TextBlock| b.bbox.y as f32 + b.bbox.height as f32 / 2.0;
    blocks.sort_by(|a, b| center(a).total_cmp(&center(b)));
    // Agrupar en líneas sobre el orden vertical y ordenar cada línea por x.
    let mut start = 0;
    while start < blocks.len() {
        let mut end = start + 1;
        while end < blocks.len() {
            let tolerance = blocks[start].bbox.height.min(blocks[end].bbox.height) as f32 / 2.0;
            if (center(&blocks[end]) - center(&blocks[start])).abs() < tolerance {
                end += 1;
            } else {
                break;
            }
        }
        blocks[start..end].sort_by_key(|b| b.bbox.x);
        start = end;
    }
}

/// Lado mayor, en píxeles, a partir del cual el frame se reduce antes de reconocer: acota la
/// memoria y el tiempo de entradas enormes (un 8K son 130 MB de RGBA).
const MAX_INPUT_SIDE: u32 = 3840;

/// Factor entero de reducción para que el lado mayor no pase de `limit`.
fn shrink_factor(width: u32, height: u32, limit: u32) -> u32 {
    width.max(height).div_ceil(limit.max(1)).max(1)
}

/// RGBA -> RGB descartando la transparencia (las capturas de pantalla son opacas). Si el frame
/// supera `limit` de lado se reduce en el mismo pase promediando bloques de `f x f` píxeles.
/// Devuelve la imagen y `f` (1 = sin reducir).
fn frame_to_rgb(frame: &Frame, limit: u32) -> Result<(RgbImage, u32)> {
    let factor = shrink_factor(frame.width, frame.height, limit) as usize;
    let (w, h) = (frame.width as usize, frame.height as usize);
    if frame.rgba.len() != w * h * 4 {
        return Err(ocr_error("the frame does not match its dimensions"));
    }
    if factor == 1 {
        let mut rgb = Vec::with_capacity(w * h * 3);
        for px in frame.rgba.as_chunks::<4>().0 {
            rgb.extend_from_slice(&[px[0], px[1], px[2]]);
        }
        return RgbImage::from_raw(frame.width, frame.height, rgb)
            .map(|image| (image, 1))
            .ok_or_else(|| ocr_error("the frame does not match its dimensions"));
    }
    let (nw, nh) = (w / factor, h / factor);
    let mut rgb = Vec::with_capacity(nw * nh * 3);
    for y in 0..nh {
        for x in 0..nw {
            let mut sum = [0u32; 3];
            for dy in 0..factor {
                let row = ((y * factor + dy) * w + x * factor) * 4;
                for px in frame.rgba[row..row + factor * 4].as_chunks::<4>().0 {
                    sum[0] += u32::from(px[0]);
                    sum[1] += u32::from(px[1]);
                    sum[2] += u32::from(px[2]);
                }
            }
            let n = (factor * factor) as u32;
            rgb.extend(sum.map(|s| (s / n) as u8));
        }
    }
    RgbImage::from_raw(nw as u32, nh as u32, rgb)
        .map(|image| (image, factor as u32))
        .ok_or_else(|| ocr_error("the frame does not match its dimensions"))
}

fn check_language(supported: &[String], lang: &Lang) -> Result<()> {
    let primary = lang.as_str().split('-').next().unwrap_or_default();
    if supported.iter().any(|s| s == primary) {
        Ok(())
    } else {
        Err(CoreError::InvalidArgument(format!(
            "unsupported OCR language `{lang}`"
        )))
    }
}

fn missing_files(dir: &Path) -> Vec<&'static str> {
    MODEL_FILES
        .iter()
        .copied()
        .filter(|name| !dir.join(name).is_file())
        .collect()
}

pub struct PaddleOcr {
    ocr: OAROCR,
    languages: Vec<String>,
}

impl PaddleOcr {
    /// Carga los modelos de `model_dir`. `languages` son los idiomas (subetiqueta principal)
    /// que ese modelo sabe reconocer. Usa el rendimiento por defecto ([`PerfConfig::default`]).
    pub fn load(model_dir: &Path, languages: &[&str]) -> Result<Self> {
        Self::load_with(model_dir, languages, &PerfConfig::default())
    }

    /// Como [`Self::load`] con los hilos y el lado máximo de detección de `perf`.
    pub fn load_with(model_dir: &Path, languages: &[&str], perf: &PerfConfig) -> Result<Self> {
        let missing = missing_files(model_dir);
        if !missing.is_empty() {
            return Err(CoreError::Model(format!(
                "the OCR model is incomplete; missing: {}",
                missing.join(", ")
            )));
        }
        let read = |name: &str| {
            std::fs::read(model_dir.join(name))
                .map_err(|e| CoreError::Model(format!("could not read `{name}`: {e}")))
        };
        let dictionary = String::from_utf8(read("dict.txt")?)
            .map_err(|_| CoreError::Model("`dict.txt` is not valid UTF-8".into()))?;
        let mut session = OrtSessionConfig::new()
            .with_intra_threads(perf.threads())
            .with_inter_threads(1);
        // Los hilos ociosos duermen en vez de girar (CPU en reposo).
        session.session_config_entries = Some(std::collections::HashMap::from([(
            "session.intra_op.allow_spinning".to_owned(),
            "0".to_owned(),
        )]));
        // Los mismos umbrales que aplica `oar-ocr` por defecto al texto general; solo cambia el
        // lado máximo con que detecta (por defecto 960).
        let mut detection = TextDetectionConfig {
            score_threshold: 0.3,
            box_threshold: 0.6,
            unclip_ratio: 2.0,
            limit_type: Some(LimitType::Max),
            max_side_len: Some(4000),
            ..TextDetectionConfig::default()
        };
        if perf.ocr_max_side > 0 {
            detection.limit_side_len = Some(perf.ocr_max_side);
        } else {
            detection.limit_side_len = Some(4000);
        }
        let ocr = OAROCRBuilder::new(read("det.onnx")?, read("rec.onnx")?, "")
            .character_dict_content(dictionary)
            .ort_session(session)
            .text_detection_config(detection)
            .build()
            .map_err(|e| ocr_error(format!("could not load the OCR models: {e}")))?;
        Ok(Self {
            ocr,
            languages: languages.iter().map(|l| (*l).to_owned()).collect(),
        })
    }
}

impl OcrEngine for PaddleOcr {
    fn recognize(&mut self, frame: &Frame, lang: &Lang) -> Result<Vec<TextBlock>> {
        check_language(&self.languages, lang)?;
        let (image, factor) = frame_to_rgb(frame, MAX_INPUT_SIDE)?;
        let scale = factor as f32;
        let mut results = self
            .ocr
            .predict(vec![image])
            .map_err(|e| ocr_error(format!("text recognition failed: {e}")))?;
        let Some(result) = results.pop() else {
            return Ok(Vec::new());
        };

        let mut blocks: Vec<TextBlock> = result
            .text_regions
            .iter()
            .filter_map(|region| {
                let (text, confidence) = region.text_with_confidence()?;
                let points = region
                    .bounding_box
                    .points
                    .iter()
                    .map(|p| (p.x * scale, p.y * scale))
                    .collect();
                Detected {
                    text: text.to_string(),
                    confidence,
                    points,
                }
                .to_block(frame.width, frame.height)
            })
            .filter(|b| !b.text.trim().is_empty())
            .collect();
        reading_order(&mut blocks);
        Ok(blocks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detected(text: &str, points: &[(f32, f32)]) -> Detected {
        Detected {
            text: text.into(),
            confidence: 0.9,
            points: points.to_vec(),
        }
    }

    fn rect(x: f32, y: f32, w: f32, h: f32) -> Vec<(f32, f32)> {
        vec![(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    }

    fn block(text: &str, x: u32, y: u32, width: u32, height: u32) -> TextBlock {
        TextBlock {
            text: text.into(),
            bbox: BBox {
                x,
                y,
                width,
                height,
            },
            confidence: 0.9,
        }
    }

    #[test]
    fn a_polygon_becomes_its_bounding_box() {
        let skewed = detected(
            "hi",
            &[(10.0, 20.0), (110.5, 22.0), (109.0, 52.0), (11.0, 50.0)],
        );
        let b = skewed.to_block(640, 480).unwrap();
        assert_eq!((b.bbox.x, b.bbox.y), (10, 20));
        assert_eq!(
            (b.bbox.width, b.bbox.height),
            (101, 32),
            "se redondea hacia arriba"
        );
        assert_eq!((b.text.as_str(), b.confidence), ("hi", 0.9));
    }

    #[test]
    fn boxes_are_clamped_to_the_image() {
        let b = detected("x", &rect(-20.0, -10.0, 100.0, 50.0))
            .to_block(60, 30)
            .unwrap();
        assert_eq!(
            (b.bbox.x, b.bbox.y, b.bbox.width, b.bbox.height),
            (0, 0, 60, 30)
        );
    }

    #[test]
    fn empty_or_outside_polygons_are_dropped() {
        assert!(detected("x", &[]).to_block(100, 100).is_none());
        assert!(
            detected("x", &rect(200.0, 200.0, 10.0, 10.0))
                .to_block(100, 100)
                .is_none()
        );
        assert!(
            detected("x", &rect(10.0, 10.0, 0.0, 10.0))
                .to_block(100, 100)
                .is_none()
        );
    }

    #[test]
    fn reading_order_goes_top_to_bottom_then_left_to_right() {
        let mut blocks = vec![
            block("c", 300, 100, 80, 30), // línea 1, derecha
            block("e", 10, 200, 80, 30),  // línea 2
            block("a", 10, 102, 80, 28),  // línea 1, izquierda (centro casi igual)
            block("b", 150, 98, 80, 34),  // línea 1, centro
        ];
        reading_order(&mut blocks);
        let order: Vec<_> = blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(order, ["a", "b", "c", "e"]);
    }

    #[test]
    fn reading_order_handles_empty_and_single_inputs() {
        let mut none: Vec<TextBlock> = Vec::new();
        reading_order(&mut none);
        let mut one = vec![block("a", 0, 0, 10, 10)];
        reading_order(&mut one);
        assert_eq!(one.len(), 1);
    }

    #[test]
    fn frames_convert_to_rgb_dropping_alpha() {
        let frame = Frame::new(2, 1, vec![1, 2, 3, 255, 4, 5, 6, 0]).unwrap();
        let (rgb, factor) = frame_to_rgb(&frame, MAX_INPUT_SIDE).unwrap();
        assert_eq!((rgb.dimensions(), factor), ((2, 1), 1));
        assert_eq!(rgb.as_raw(), &[1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn oversized_frames_are_shrunk_by_averaging_blocks() {
        // 4x2 con límite 2: factor 2, bloques de 2x2 -> 2x1.
        let mut rgba = Vec::new();
        for y in 0..2u8 {
            for x in 0..4u8 {
                let value = if x < 2 { 10 + y * 10 } else { 200 };
                rgba.extend_from_slice(&[value, value, value, 255]);
            }
        }
        let frame = Frame::new(4, 2, rgba).unwrap();
        let (rgb, factor) = frame_to_rgb(&frame, 2).unwrap();
        assert_eq!((rgb.dimensions(), factor), ((2, 1), 2));
        assert_eq!(
            rgb.as_raw(),
            &[15, 15, 15, 200, 200, 200],
            "promedio de 10 y 20"
        );
    }

    #[test]
    fn the_shrink_factor_keeps_the_longest_side_within_the_limit() {
        assert_eq!(shrink_factor(1920, 1080, 3840), 1);
        assert_eq!(shrink_factor(3840, 2160, 3840), 1);
        assert_eq!(shrink_factor(7680, 4320, 3840), 2);
        assert_eq!(shrink_factor(7681, 10, 3840), 3);
        assert_eq!(shrink_factor(10, 10, 0), 10, "límite 0 se trata como 1");
    }

    #[test]
    fn a_frame_with_a_wrong_buffer_is_refused() {
        let frame = Frame {
            width: 2,
            height: 2,
            rgba: vec![0; 7],
        };
        assert!(frame_to_rgb(&frame, MAX_INPUT_SIDE).is_err());
    }

    #[test]
    fn language_support_uses_the_primary_subtag() {
        let supported = vec!["en".to_owned(), "ja".to_owned()];
        assert!(check_language(&supported, &Lang::new("en").unwrap()).is_ok());
        assert!(check_language(&supported, &Lang::new("en-US").unwrap()).is_ok());
        let error = check_language(&supported, &Lang::new("ko").unwrap()).unwrap_err();
        assert!(
            matches!(&error, CoreError::InvalidArgument(m) if m.contains("unsupported OCR language")),
            "{error}"
        );
    }

    #[test]
    fn loading_without_models_names_the_missing_files() {
        let dir = std::env::temp_dir().join(format!("tr-ocr-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let Err(error) = PaddleOcr::load(&dir, &["en"]) else {
            panic!("debe fallar")
        };
        let CoreError::Model(message) = error else {
            panic!("debe ser un error de modelo")
        };
        assert!(
            message.contains("det.onnx")
                && message.contains("rec.onnx")
                && message.contains("dict.txt"),
            "{message}"
        );
    }

    #[test]
    fn a_missing_folder_is_also_a_model_error() {
        let Err(error) = PaddleOcr::load(Path::new("/definitely/not/here"), &["en"]) else {
            panic!("debe fallar")
        };
        assert!(matches!(error, CoreError::Model(_)));
    }
}
