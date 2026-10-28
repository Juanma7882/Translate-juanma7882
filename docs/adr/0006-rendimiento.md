# ADR 0006 — Rendimiento y caché del pipeline

- Estado: aceptado
- Fecha: 2026-10-28
- Contexto: Hito 5A (`openspec/changes/hito-5-rendimiento`). Mediciones y método en `docs/perf/hito-5.md`.

## Decisión

| Tema | Elección |
|---|---|
| Decoder de traducción | Export "merged" de Xenova con caché de claves/valores, detectado por sus entradas (`use_cache_branch`, `past_key_values.*`). Sin ellas se usa el decoder sin caché. `decoder_merged.onnx` se prefiere si existe (transitorio) |
| Búsqueda | Beam search propio (`translate/beam.rs`, independiente del modelo y probado sin ONNX), 1..8 haces. **Defecto: 1 (voraz)** |
| Configuración | `tr_adapters::perf::PerfConfig` (`intra_threads`, `beam_size`, `ocr_max_side`, `low_memory`); cada motor lo recibe con `load_with`. `EngineConfig.perf` es la base y `EngineConfig.performance` (hilos, haz; viene de Ajustes) la sobrescribe |
| Hilos | Automático = mitad de los núcleos entre 1 y 4; traducción limitada a 2. Sin espera activa y 1 hilo entre operadores |
| Memoria | Arena de la CPU desactivado en voz (siempre) y en traducción con `low_memory` |
| OCR | Lado de detección configurable (960 por defecto, igual que antes); frames con lado > 3840 se reducen por bloques en el mismo pase RGBA -> RGB y las cajas vuelven a coordenadas originales |
| Caché de traducciones | Clave normalizada (minúsculas y espacios colapsados), no guarda textos > 2000 caracteres, contadores atómicos (aciertos, fallos, inserciones, desalojos); una sola caché por motor que sobrevive a reinicios de sesión |
| Detección de cambio | Muestreo 1 de cada 2 píxeles por eje, sin división por píxel, buffers reciclados |
| Arranque | Los modelos independientes se cargan en paralelo con `std::thread::scope`: OCR + traducción, voz + traducción, y dentro de cada motor sesiones y tokenizador |

## Por qué

- **Haces apagados por defecto.** En 14 frases con referencias propias la búsqueda por haces no mejoró la calidad (chrF voraz 86,3; 2 haces 81,5; 4 haces 79,9) y añadió 25-40 % de latencia; omitió palabras ("más tarde"). Queda configurable porque el modelo la trae (`num_beams = 4`) y otros pares o textos pueden beneficiarse, y la voraz es el respaldo natural.
- **La caché KV no cambia calidad ni contrato:** las 10 frases exactas de los tests reales pasan en voraz con el decoder "merged", y el decoder sin caché sigue cubierto por un test.
- **Pocos hilos.** La traducción rinde igual con 1 que con 4 hilos (el coste está en operadores secuenciales); sin espera activa los hilos ociosos duermen y el reposo no consume CPU.
- **Arena fuera en voz.** Whisper retenía ~800 MiB de activaciones; sin arena queda en ~270 MiB estables a cambio de +17 % de latencia, dentro del presupuesto de audio.
- **La caché del motor vive con el motor.** Antes se creaba una por sesión y se perdía al cambiar de modo; la clave ya incluye el par de idiomas.
- **Carga paralela con hilos del sistema,** sin tokio en el núcleo (ADR 0002).

## Hallazgos

- El cuello de botella por paso del decoder cuantizado es la dequantización de la matriz de salida (~5 ms por paso) más su producto (~7 ms); por eso la caché ahorra menos de lo esperado en frases cortas (-18 % de media, más en textos largos).
- Un decoder fp32 reduce la traducción a 146 ms (-42 %) con +176 MB de disco y +130 MiB de RAM. Es una opción de calidad/velocidad para un manifiesto futuro, no el defecto.
- `xcap` en X11 tarda ~187 ms por captura, igual para 800x150 que para 1280x720: reconecta con el servidor X en cada llamada. Con el intervalo por defecto de 200 ms la captura domina el ciclo. Si el Hito 6 necesita más cadencia habrá que capturar con una conexión persistente (xcb directo en Linux) o medir Windows/macOS, donde la API es otra.
- La detección de cambio ya evitaba el OCR en frames sin cambios; ahora cuesta 4-5 veces menos.
- **Fallo intermitente "Connection error" en `real_fallback` (5B).** `xcap` abre una conexión X nueva en cada captura (no se puede reutilizar desde su API). Bajo Xvfb, que por defecto se regenera al cerrarse el último cliente, una conexión que llegaba en ese instante fallaba (2 de 8 ejecuciones) justo después de que el test retirara su ventana y no quedaran más clientes. Con `-noreset` en `scripts/with-xvfb.sh` pasó 15 de 15, y el adaptador reintenta ahora hasta 3 veces con 40 ms de espera los errores de conexión transitorios (`Connection error`, E/S, tubería rota); también pasó 15 de 15 con Xvfb sin `-noreset`. Un error que persiste o permanente (región inválida, entorno no soportado) llega igual, una vez, como `CoreError::Capture` con la causa del sistema.

## Consecuencias

- **Hecho (5B): el manifiesto entrega `decoder_model_merged_quantized.onnx` como `decoder.onnx`** en los 10 pares, con SHA-256 y tamaño reales descargados par a par (en-es `58ee5ddd...30ae` y es-en `4cd91ab3...05fa`, 60 212 804 bytes; los demás en `docs/perf/hito-5.md`). El respaldo sin caché sigue en el código y en un test; `decoder_merged.onnx` queda solo como compatibilidad de carpetas de desarrollo. Medido en 5B: traducción -20 %, frame -> traducción -12 %, arranque +250 ms, RAM tras arrancar +75 MiB, pico -20 %.
- Con el "merged" el arranque de texto pasa de ~370 a ~720 ms (optimizar el grafo con `If` es más lento) y la RAM sube ~70 MiB; la latencia de frame baja ~12 %.
- **Hecho (5B): los bindings exponen `performance.ocrMaxSide` (160 a 4000), `performance.lowMemory` y `cacheStats()`** (solo contadores; sin contenido). Ajustes (pestaña Avanzado) conecta `ocrMaxSide` y `lowMemory`; las estadísticas de la caché no se muestran en la interfaz.
- Pendiente de medir: Windows y macOS, audio en vivo, texto con ruido real.

## Alternativas descartadas

- Subir el defecto a 4 haces: peor calidad medida y más latencia.
- Reducir antes del OCR por debajo de 960: puede perder letra pequeña; queda como ajuste.
- Modificar el modelo ONNX al cargar para evitar la dequantización repetida: sin crate de ONNX en el árbol, coste de mantenimiento desproporcionado.
