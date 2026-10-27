# ADR 0004 — Reconocimiento de voz y captura del audio del sistema

- Estado: aceptado
- Fecha: 2026-10-27
- Contexto: Hito 3 (`openspec/changes/hito-3-audio`). Medido en WSL (Ubuntu 24.04), CPU, 4 hilos de ONNX Runtime, binarios `--release`. Restricción del entorno: sin `cmake`, `clang` ni paquetes `-dev` de audio y sin sudo no interactivo; lo que compile aquí compila en el CI sin pasos extra.

## Decisión

| Pieza | Elección |
|---|---|
| STT | Whisper **base** int8 (`Xenova/whisper-base`) en ONNX con `ort` =2.0.0-rc.13 (el de OCR y traducción); `whisper-tiny` en el manifiesto como alternativa ligera |
| Características | log-mel propio con `realfft` =3.5.1 (réplica de `WhisperFeatureExtractor`) |
| Decodificación | voraz con caché KV (decoder "merged", `use_cache_branch`), tokenizador byte-level propio solo para decodificar |
| Captura Linux | `pulseaudio` =0.3.2 (protocolo nativo en Rust puro; sirve a PulseAudio y PipeWire), monitor del dispositivo de salida |
| Captura Windows / macOS | `cpal` =0.18.2 (WASAPI loopback / tap de CoreAudio 14.6+), solo como dependencia de esos destinos |
| Remuestreo | sinc con ventana propio (`Resampler`) a mono f32 16 kHz, trozos de 100 ms |

Se descartaron: `whisper-rs` / whisper.cpp (compila C++ y exige `cmake`; no hay en el entorno), `cpal` en Linux (su backend ALSA exige `libasound2-dev`), `libpulse-binding` (exige `libpulse-dev`) y procesos externos como `parec` (no hay en WSL ni se puede garantizar).

## Evidencia

### STT — mediana de 3 ejecuciones, voces SAPI de Windows (David en-US, Helena es-ES), 16 kHz

| Modelo | Descarga | Carga | Audio de 4,9 s | Ventana de 2 s | Resultado |
|---|---|---|---|---|---|
| tiny int8 | 41,9 MB | 0,32 s | 0,55 s | ~0,40 s | "Where is the train station? Thank you very much for your help." / "Hola, ¿cómo estás? Muchas gracias por tu ayuda." |
| base int8 | 77,9 MB | 0,56 s | 1,0 s | ~0,80 s | igual en inglés; "Hola, como estás. Muchas gracias por tu ayuda." |

El encoder de Whisper procesa siempre 30 s de espectrograma, así que la latencia casi no depende de la duración de la ventana. Ambos modelos van por debajo del tiempo real con ventanas de 2 s. Se elige **base** por calidad con audio real y ruido (tiny multilingüe es notablemente peor en idiomas distintos del inglés); si en la validación de Windows la CPU no da abasto se cambia el modelo del manifiesto a tiny sin tocar código.

### Captura real (WSLg)

El monitor de la salida por defecto entrega trozos de 100 ms consecutivos; arranque, parada (cerrando el socket), reinicio y error sin servidor verificados. Punta a punta: una frase reproducida por la salida se captura, se transcribe, se traduce y llega como subtítulo final (`tr-engine/tests/real_audio.rs`, 7,4 s).

## Hallazgos que cambian el diseño

1. **Los exports de Xenova traen salidas gigantes**: el encoder devuelve las atenciones (4 x 6 x 1500 x 1500 f32, ~216 MB) y el decoder las atenciones cruzadas en cada paso. Se piden solo las salidas necesarias con `RunOptions` + `OutputSelector`.
2. **`<|endoftext|>` está en `vocab.json`**, no en `added_tokens.json`; los tokens de idioma sí vienen de `added_tokens.json` (ids entre `endoftext` y `<|translate|>`).
3. **Whisper anota el silencio** (`[BLANK_AUDIO]`, `(música)`): se filtra todo texto entre corchetes/paréntesis/asteriscos o sin letras. Además se descarta la ventana si `no_speech > 0,6` y `avg_logprob < -1`.
4. **Parcial/final**: el STT no sabe si una ventana cierra la frase. El puerto gana `push_window(chunk, closes_utterance)` y `end_utterance()` (ambos con implementación por defecto); sin `end_utterance` la frase quedaba sin cerrar cuando la última ventana coincidía justo con el final del habla. `WhisperStt` acumula las ventanas (`Utterance`) y emite un parcial creciente y un final con la frase completa (también a los 8 s sin pausa), que es lo que se traduce.
5. **WSLg exige una cookie de 256 bytes** en la autenticación de PulseAudio; con una cookie vacía cierra la conexión. Se rellena con ceros cuando no hay archivo de cookie.
6. **Cobertura de idiomas**: Whisper reconoce unos 99; el manifiesto lista en, es, fr, de, pt, it, ja, zh. Lo que limita el uso son los pares de traducción disponibles (en-es, es-en).

## Datos para el manifiesto

Revisiones inmutables: `whisper-base` `64da57285918e20ea79ea5c88eed7197933abaa8`, `whisper-tiny` `5332fcc35e32a33b86612b9a57a89be7906102b1`.

| Archivo local | Origen | base (bytes / SHA-256) | tiny (bytes / SHA-256) |
|---|---|---|---|
| encoder.onnx | `onnx/encoder_model_quantized.onnx` | 23 200 850 / 3e345e97...74285f9 | 10 124 910 / fd9d995b...802dc438e |
| decoder.onnx | `onnx/decoder_model_merged_quantized.onnx` | 53 707 539 / a6beb6ba...64cf861 | 30 727 765 / 6c0c1259...4927a0 |
| vocab.json | `vocab.json` | 1 036 584 / 50d6a919...e2c1a | igual |
| added_tokens.json | `added_tokens.json` | 2 082 / ce949fe7...7dd7e88 | igual |

(Las huellas completas están en `crates/tr-models/models.json`; la descarga real por `tr-models` las verificó.)

## Consecuencias y riesgos

- **No verificado en WSL**: la captura loopback de Windows (WASAPI) y de macOS (tap de CoreAudio, 14.6+, con permiso TCC): solo compila (`cargo check --target x86_64-pc-windows-gnu`). Ver `docs/validation/windows-hito-3.md`.
- `pulseaudio` y `cpal` son dependencias nuevas, fijadas con `=`; ambas activas (octubre y agosto de 2026).
- Coste del encoder de 30 s fijos: optimizable (cuantización más agresiva, ventanas más largas con menos solape) en el Hito 5. El remuestreo calcula senos por muestra (~5 % de un núcleo); se puede tabular si hace falta.
- Un servidor de sonido sin monitor del dispositivo por defecto da un error de captura; la selección de dispositivo queda para el Hito 5.
- Calidad con música, varias voces y ruido de fondo: sin medir; es lo primero a evaluar en Windows.
