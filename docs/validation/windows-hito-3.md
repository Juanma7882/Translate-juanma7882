# Validación manual en Windows y macOS — Hito 3 (audio del sistema)

El desarrollo se hizo en WSL (Ubuntu). Ahí se verificó la captura real contra WSLg (PulseAudio), el
reconocimiento de voz con modelos reales y la cadena completa (reproducir -> capturar -> transcribir
-> traducir -> subtítulo). Esta lista cubre lo que **solo** se puede comprobar en Windows (WASAPI
loopback) y en macOS (tap de CoreAudio). Marca cada punto y anota el resultado.

## Preparación

1. Construir como en `windows-hito-2.md` (Rust MSVC, Node 22, `npm run build` en `crates/tr-bindings`, `npm run build` en `app`).
2. Modelos de audio: `cargo run --release -p tr-models --example fetch -- <carpeta> en es audio` (≈193 MB entre voz y traducción) o el botón "Descargar modelos de audio" de Ajustes.
3. Pruebas automáticas que deberían pasar: `cargo test --workspace` y `cd app && npm test`. Con modelos: `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-adapters --test stt_real -- --ignored --test-threads=1`.
4. Fuente de audio: un vídeo o podcast en inglés con voz clara, reproducido por los altavoces o auriculares por defecto.

## 1. Captura loopback (Windows, WASAPI)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | `startAudioSubtitles('en','es')` con motores reales mientras suena el vídeo | Llegan subtítulos parciales (sin traducir) y finales traducidos |
| 1.2 | Pausar el vídeo | No llegan subtítulos nuevos ni errores |
| 1.3 | Cambiar el dispositivo de salida por defecto (altavoces -> auriculares) con la captura activa | Se sigue capturando o el error es descriptivo; anotar el comportamiento |
| 1.4 | Dispositivo a 44,1 kHz, 48 kHz y 96 kHz, estéreo y 5.1 | Mismo texto reconocido en todos (mezcla y remuestreo correctos) |
| 1.5 | Sin ningún dispositivo de salida (desactivarlo) | `startAudioSubtitles` falla con un error de captura claro; no queda ningún hilo |
| 1.6 | Volumen del sistema al mínimo o silenciado | Se captura igualmente (el loopback es previo al volumen); anotar si no |
| 1.7 | `stop()` y volver a arrancar 10 veces | Sin fugas de hilos ni errores; el uso de memoria no crece |

## 2. Calidad y rendimiento

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Voz clara en inglés durante 5 minutos | Texto correcto; subtítulo final tras cada pausa |
| 2.2 | Música con letra, efectos o ruido de fondo | Sin frases inventadas durante los silencios; anotar alucinaciones |
| 2.3 | Varias voces o solapadas | Anotar el comportamiento (no hay diarización) |
| 2.4 | CPU durante 5 minutos de habla continua (Administrador de tareas) | El motor mantiene el tiempo real: sin cola creciente de subtítulos |
| 2.5 | Latencia entre la frase y su subtítulo final | Menor de ~3 s tras terminar la frase |
| 2.6 | Si 2.4 o 2.5 fallan, cambiar los idiomas del manifiesto a `stt-whisper-tiny` y repetir | Anotar la diferencia de calidad y CPU |

## 3. Privacidad

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Procmon (filtro `WriteFile` del proceso) durante la sesión de audio | Ninguna escritura de audio ni texto; solo la carpeta de modelos y la configuración |
| 3.2 | Desconectar la red tras descargar los modelos | Todo sigue funcionando |

## 4. macOS (14.6 o posterior)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Primer arranque de la captura | macOS pide el permiso de captura de audio del sistema; tras concederlo hay subtítulos |
| 4.2 | Denegar el permiso | Error descriptivo, sin cuelgues; anotar el texto del error |
| 4.3 | macOS anterior a 14.6 | La captura falla con un error comprensible (el loopback no existe) |
| 4.4 | Apple Silicon e Intel: latencia de una ventana de 2 s | Menor que 2 s; si no, usar tiny |

## 5. Interfaz

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 5.1 | Ajustes -> Subtítulos del audio con motor local | Muestra el modelo de voz y la traducción con su estado y tamaño |
| 5.2 | Pulsar "Descargar modelos de audio" | Progreso creciente y, al terminar, "Los modelos de audio están listos" |

## Resultados

Anotar aquí fecha, equipo, versión de Windows/macOS y cada incidencia encontrada.
