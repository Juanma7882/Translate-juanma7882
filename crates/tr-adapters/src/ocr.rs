//! OCR real con PaddleOCR (PP-OCRv6) sobre ONNX Runtime, mediante `oar-ocr`.
//!
//! Los modelos se leen de una carpeta (`det.onnx`, `rec.onnx`, `dict.txt`) y se cargan desde
//! memoria. Nada se escribe a disco y no hay acceso a la red al reconocer.

use std::path::Path;

use image::RgbImage;
use oar_ocr::prelude::*;
use tr_core::{BBox, CoreError, Frame, Lang, OcrEngine, Result, TextBlock};

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

/// RGBA -> RGB descartando la transparencia (las capturas de pantalla son opacas).
fn frame_to_rgb(frame: &Frame) -> Result<RgbImage> {
    let rgb: Vec<u8> = frame
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[0], p[1], p[2]])
        .collect();
    RgbImage::from_raw(frame.width, frame.height, rgb)
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
    /// que ese modelo sabe reconocer.
    pub fn load(model_dir: &Path, languages: &[&str]) -> Result<Self> {
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
        let ocr = OAROCRBuilder::new(read("det.onnx")?, read("rec.onnx")?, "")
            .character_dict_content(dictionary)
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
        let image = frame_to_rgb(frame)?;
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
                    .map(|p| (p.x, p.y))
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
        let rgb = frame_to_rgb(&frame).unwrap();
        assert_eq!(rgb.dimensions(), (2, 1));
        assert_eq!(rgb.as_raw(), &[1, 2, 3, 4, 5, 6]);
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
