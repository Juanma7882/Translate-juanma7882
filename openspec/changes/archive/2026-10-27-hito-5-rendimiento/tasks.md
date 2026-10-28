# Tasks

## 1. Medición base

- [x] 1.1 Ejemplo `perf` de `tr-adapters` (traducción con chrF, OCR, voz, detección de cambio, captura) que solo imprime números
- [x] 1.2 Línea base antes de optimizar (latencias, RAM, carga) y escalado por hilos

## 2. Traducción

- [x] 2.1 `PerfConfig` y sesiones ORT comunes (hilos, sin giro, arena opcional)
- [x] 2.2 Búsqueda por haces independiente del modelo con tests
- [x] 2.3 Decoder con caché de claves/valores y respaldo sin caché; carga paralela
- [x] 2.4 Tests reales: frases exactas voraces, haces, respaldo sin caché

## 3. Núcleo

- [x] 3.1 Caché con normalización, tope, capacidad y contadores, con tests
- [x] 3.2 Detector de cambio con muestreo y buffers reutilizados, con tests

## 4. OCR y voz

- [x] 4.1 Lado de detección configurable, reducción de frames enormes y cajas en coordenadas originales, con tests
- [x] 4.2 Voz: hilos configurables, arena desactivado, carga paralela

## 5. Composición

- [x] 5.1 `EngineConfig.perf` combinado con `performance`; carga paralela en `real.rs`
- [x] 5.2 Ejemplo `perf_engine` (arranque, CPU en reposo, latencia frame a traducción, RAM)

## 6. Documentación y cierre

- [x] 6.1 `docs/perf/hito-5.md` con presupuestos y método, y ADR 0006
- [x] 6.2 Verificación completa (fmt, clippy, tests, pruebas reales en serie) y memoria en Engram
