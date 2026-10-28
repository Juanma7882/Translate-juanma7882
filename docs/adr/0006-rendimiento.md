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

## Consecuencias

- **El manifiesto de modelos (`tr-models/models.json`) debe pasar a `decoder_model_merged_quantized.onnx` como `decoder.onnx`** para que la caché KV llegue a producción. Pares verificados: en-es `58ee5ddd6e22d1693d8722b90c1486afb93700a4376cf28fd74175052ad530ae` y es-en `4cd91ab30240d295ce907b5100826031838c672005e57e524d711122d75605fa`, ambos 60 212 804 bytes (URLs con el mismo commit que el resto del par, carpeta `onnx/`). Los demás pares nuevos hay que comprobarlos uno a uno.
- Con el "merged" el arranque de texto pasa de ~370 a ~720 ms (optimizar el grafo con `If` es más lento) y la RAM sube ~70 MiB; la latencia de frame baja ~12 %.
- Las opciones `ocrMaxSide`, `lowMemory` y `cacheStats` no están en el puente JS (`performance` solo lleva hilos y haz); conectarlas es trabajo de los bindings.
- Pendiente de medir: Windows y macOS, audio en vivo, texto con ruido real.

## Alternativas descartadas

- Subir el defecto a 4 haces: peor calidad medida y más latencia.
- Reducir antes del OCR por debajo de 960: puede perder letra pequeña; queda como ajuste.
- Modificar el modelo ONNX al cargar para evitar la dequantización repetida: sin crate de ONNX en el árbol, coste de mantenimiento desproporcionado.
