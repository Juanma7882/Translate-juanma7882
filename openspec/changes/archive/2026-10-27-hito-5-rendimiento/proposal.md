## Why

Los hitos 1-4 dejaron el pipeline funcional pero sin optimizar: el decoder de traducción recalcula toda la secuencia en cada paso, las sesiones de ONNX Runtime giran con espera activa, la memoria de Whisper supera 1 GiB y no hay presupuestos de rendimiento medidos. Antes del pulido final hace falta medir con método repetible y optimizar con evidencia, sin romper las reglas (todo en RAM, nada de contenido a logs, patrón adapter).

## What Changes

- Traducción Opus-MT: decoder con caché de claves/valores (export "merged", detectado por sus entradas, con el decoder sin caché como respaldo) y búsqueda por haces acotada y configurable (`beam_size` 1..8; 1 = voraz).
- `PerfConfig` en `tr-adapters` (hilos, haces, lado de detección del OCR, modo de poca memoria) consumido por OCR, traducción y voz; `EngineConfig.perf` lo compone con `EngineConfig.performance`.
- Caché de traducciones: clave normalizada (espacios), tope de longitud, contadores de aciertos/fallos/desalojos (solo números) y capacidad consultable.
- Detección de cambio de frames: muestreo y reutilización de buffers; OCR: lado de detección configurable, reducción de frames enormes y conversión RGBA a RGB en un pase.
- ONNX Runtime: hilos de espera sin giro, un hilo entre operadores, hilos por defecto medidos, arena de memoria desactivada en voz, carga paralela de modelos.
- Documento `docs/perf/hito-5.md` con presupuestos medidos y método, ADR 0006, ejemplos de medición `perf` y `perf_engine` (solo imprimen números).

## Capabilities

### New Capabilities
- `performance-budget`: presupuestos medidos y método de medición repetible, sin contenido a disco ni a logs.

### Modified Capabilities
- `text-translation`: caché de claves/valores, búsqueda por haces configurable y decoder de respaldo.
- `core-ports`: caché de traducciones con contadores y límites; detección de cambio acotada en coste.
- `ocr-recognition`: límites de tamaño, lado de detección configurable y reducción de entradas enormes.
- `speech-recognition`: hilos y memoria configurables.
- `engine-composition`: parámetros de rendimiento y carga paralela de modelos al arrancar.

## Impact

- Código: `crates/tr-adapters` (perf, opus, beam, ocr, whisper), `crates/tr-core` (cache, change), `crates/tr-engine` (engine, real, ejemplo).
- Modelos: el decoder "merged" de Xenova (`decoder_model_merged_quantized.onnx`) permite la caché; el manifiesto (`tr-models`, fuera de este cambio) debe entregarlo como `decoder.onnx`.
- Sin cambios en `app/**`, `tr-models` ni `tr-bindings`; la opción de rendimiento ya expuesta (`performance`) se consume aquí.
