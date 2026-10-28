# Rendimiento — Hito 5A

Mediciones y presupuestos del pipeline. Decisiones y razones en `docs/adr/0006-rendimiento.md`; cambio OpenSpec `hito-5-rendimiento`. Las herramientas solo imprimen números: ni capturas, ni audio, ni textos, ni traducciones salen a disco ni a consola.

## Entorno de las mediciones

WSL2 Ubuntu 24.04, 12 núcleos lógicos, 16 GiB, CPU (sin GPU), binarios `--release`, ONNX Runtime 1.2x (`ort` 2.0.0-rc.13), modelos int8 (Opus-MT en-es, PP-OCRv6 small, Whisper base). La máquina compartía CPU con otras compilaciones (carga 13-15), así que cada cifra es la **mediana de 3 ejecuciones alternadas** antes/después (mismo binario de medición, código de `HEAD` frente al árbol de trabajo). Las cifras absolutas sirven para comparar, no para prometer.

## Resultados antes / después

| Medida | Antes | Después | Cambio |
|---|---|---|---|
| Traducción, media de medianas por frase (14 frases, 19-61 car.) | 339 ms | 277 ms | -18 % |
| Traducción, carga del modelo | 380 ms | 465 ms | +85 ms (decoder "merged" más grande de optimizar) |
| Traducción, RAM (RSS) | 646 MiB | 577 MiB | -69 MiB |
| OCR subtítulo 495x79 | 46-54 ms | 33-36 ms | -30 % |
| OCR frame 1080p | 161-177 ms | 138-164 ms | -8 % |
| OCR RAM | 305-317 MiB | 302-311 MiB | = |
| Detección de cambio 1080p | 3,3-3,8 ms | 0,7-1,1 ms | -70 % |
| Detección de cambio 720p | 1,5-2,1 ms | 0,3-0,5 ms | -75 % |
| Voz, transcribir 4,9 s de audio | 935-986 ms | 1099-1189 ms | +17 % (arena de memoria desactivado) |
| Voz, RAM estable (RSS) | 1040 MiB | 271-313 MiB | -70 % |
| Voz, RAM pico | 1040 MiB | 810 MiB | -22 % |
| Audio, ventana de 4,9 s -> subtítulo (voz + traducción) | 1387-1426 ms | 1496-1812 ms | +8..+27 % |
| Audio, RAM con voz y traducción cargadas | 1650 MiB | 876 MiB (pico 1360) | -47 % |
| Motor completo, arranque con modelos de texto | 618 ms | 368 ms con decoder sin caché; 716-776 ms con el "merged" | carga paralela OCR + traducción |
| Motor completo, frame con texto -> traducción | 454 ms (445-484) | 394-407 ms (364-449) | -10..-13 % |
| Motor completo, CPU en reposo (pantalla sin cambios) | 0,8 % de un núcleo | 0,9-1,0 % | = |
| Motor completo, CPU con texto estable ya traducido | 2,0 % | 2,3 % | = |
| Captura de una región (xcap, X11) | 187 ms | 187 ms | = (coste fijo de xcap, ver ADR) |

Calidad de la traducción (chrF contra referencias propias, 14 frases): voraz con el decoder sin caché 86,79; voraz con caché 86,30; 2 haces 81,48; 4 haces 79,94. Las frases exactas de los tests reales siguen cumpliéndose en voraz con caché.

## Hallazgos que explican las cifras

- La caché de claves/valores ahorra poco en frases de subtítulo (8-20 piezas): cada paso del decoder cuantizado cuesta ~20 ms por un suelo fijo (la matriz de salida se dequantiza en cada paso, ~5 ms, y el producto de 65 001 columnas ~7 ms), no por recomputar la secuencia. La ganancia crece con la longitud.
- Con la traducción, **1 hilo rinde igual que 4** (259 ms frente a 273 ms); el valor automático se limita a 2.
- OCR: el lado de detección (por defecto 960, el de PaddleOCR) manda: 1080p cuesta 165 ms con 960, 116 ms con 768, 87 ms con 640 y 57 ms con 480, y la RAM baja de 311 a 246, 199 y 154 MiB. A 640 y 480 el texto de prueba (alto de 79 px) se sigue leyendo; con letra pequeña hay que validarlo antes de bajar el defecto.
- Desactivar el arena de memoria de ONNX Runtime: voz 1101 -> 271 MiB estables; traducción 577 -> 316 MiB pero +25 % de latencia (por eso solo `low_memory` lo hace en traducción).
- Un decoder fp32 "merged" (+176 MB de disco) baja la traducción a 146 ms (-42 %) con la misma calidad que el original (chrF 86,79), a cambio de +130 MiB de RAM y 900 ms de carga: queda documentado como opción, no es el defecto.
- Nivel de optimización de grafo de ONNX Runtime: Level1 carga en 363 ms frente a 463 ms pero infiere 10 % más lento; se deja el defecto.

## Presupuestos

Umbrales que no deben empeorar (medidos en el entorno de arriba; en otra máquina se re-miden con el método de abajo y se ajustan los umbrales, no el código).

| Presupuesto | Valor medido | Umbral |
|---|---|---|
| Latencia texto, frame con texto -> traducción (intervalo 100 ms, incluye 2 frames estables) | 394-407 ms | <= 600 ms |
| Latencia texto, solo OCR de un subtítulo | 33-36 ms | <= 80 ms |
| Latencia audio, ventana de ~5 s -> subtítulo | 1,5-1,8 s | <= 2,5 s |
| RAM pico, modo texto (OCR + traducción) | ~830 MiB | <= 1 GiB |
| RAM pico, voz + traducción | ~1360 MiB | <= 1,5 GiB |
| RAM estable, voz + traducción | ~880 MiB | <= 1 GiB |
| CPU en reposo (pantalla sin cambios, intervalo 200 ms) | 0,9-1,0 % de un núcleo | <= 2 % |
| Arranque con modelos de texto | 0,7-0,8 s | <= 1,2 s |
| Detección de cambio a 1080p | 0,7-1,1 ms | <= 2 ms |

## Método para repetir

Modelos de prueba en `~/.cache/translate-test-models` (`TR_MODELS_DIR`). Todo desde WSL con `LIBRARY_PATH` y `LD_LIBRARY_PATH` de `CLAUDE.md`.

```bash
# Adaptadores (solo números). Subcomandos: mt, ocr, stt, audio, frame, capture
TR_MODELS_DIR=$HOME/.cache/translate-test-models \
  cargo run --release -p tr-adapters --example perf -- mt
scripts/with-xvfb.sh cargo run --release -p tr-adapters --example perf -- capture

# Motor completo: arranque, CPU en reposo, frame -> traducción, RAM
TR_MODELS_DIR=$HOME/.cache/translate-test-models \
  scripts/with-xvfb.sh cargo run --release -p tr-engine --example perf_engine
```

Variables: `TR_BEAMS`, `TR_THREADS` (0 = automático), `TR_OCR_MAX_SIDE`, `TR_LOWMEM`, `TR_MT_DIR` (carpeta del par; con un `decoder.onnx` sin caché y sin `decoder_merged.onnx` mide el respaldo), `TR_IDLE_SECS`, `TR_SHOW` (imprime las frases de prueba fijas, nunca contenido del usuario).

Para comparar antes/después: `git worktree add ~/base HEAD`, compilar allí el mismo ejemplo con `CARGO_TARGET_DIR` distinto y alternar ambos binarios al menos 3 veces; quedarse con la mediana. Con la máquina ocupada las cifras absolutas se inflan: comparar siempre ejecuciones alternadas.

Qué no se mide aquí: Windows y macOS (hay que repetir en cada plataforma antes del Hito 6), audio de sistema en vivo (se midió la ventana ya capturada), texto de juegos con ruido real.
