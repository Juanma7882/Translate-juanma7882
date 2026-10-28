## Context

Medido en WSL (12 núcleos, 16 GiB), antes del cambio: traducción 391 ms de media por frase (carga 506 ms, 646 MiB), OCR de subtítulo 52 ms, voz 998 ms para 4,9 s de audio (1045 MiB), detección de cambio 3,2 ms a 1080p. Decoder Opus-MT sin caché, sesiones con espera activa.

## Goals / Non-Goals

**Goals:** caché KV, haces configurables, menos CPU en reposo y RAM, arranque más rápido, presupuestos documentados y repetibles.
**Non-Goals:** cambiar el manifiesto de modelos (`tr-models`), tocar la UI o los bindings, aceleración por GPU.

## Decisions

- **Decoder "merged" detectado por entradas** (`use_cache_branch` + `past_key_values.*`); sin ellas se usa el decoder sin caché. `decoder_merged.onnx` se prefiere si existe (transitorio hasta que el manifiesto entregue el merged como `decoder.onnx`).
- **Búsqueda por haces** independiente del modelo (`beam.rs`, trait `Decode`) con esquema Hugging Face; 1 haz equivale a voraz. Por defecto 1: en las frases de prueba los haces no mejoran la calidad (chrF) y cuestan latencia.
- **`PerfConfig`** por motor vía `load_with`; `load` conserva firma. Hilos automáticos = mitad de núcleos entre 1 y 4; traducción limitada a 2 (más hilos no ayudan).
- **ORT:** sin espera activa, `inter_threads = 1`; arena desactivado en voz (−830 MiB estables); `low_memory` lo desactiva también en traducción.
- **OCR:** `limit_side_len` configurable (equivale al valor por defecto de oar-ocr, 960); frames > 3840 se reducen por bloques en el mismo pase RGBA a RGB.
- **Núcleo:** caché con contadores atómicos; detector con `sample_step` 2 y buffers reciclados.
- **Carga paralela** con `std::thread::scope` (sin tokio).

## Risks / Trade-offs

- El decoder cuantizado dequantiza la matriz de salida en cada paso (~5 ms): el suelo de latencia por token es ~20 ms; un decoder fp32 (+176 MB) reduce 42 % y queda como opción documentada.
- Muestreo del detector: texto muy fino podría pasar inadvertido; `sample_step = 1` lo restablece.
- Arena desactivado en voz: +13 % de latencia a cambio de RAM.

## Open Questions

- El manifiesto debe pasar a `decoder_model_merged_quantized.onnx` (sha y tamaño en el informe) para activar la caché en producción.
