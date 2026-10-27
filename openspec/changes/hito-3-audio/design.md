# Design

## Context

El núcleo ya tiene `AudioPipeline` (VAD por energía, ventanas de 2 s con solape de 0,5 s, STT, traducción de finales) y los puertos `AudioCapture` y `SpeechToText`, probados con fakes. `tr-engine` solo construye motores de demostración para audio. El entorno de desarrollo (WSL) no tiene `cmake`, `clang` ni paquetes `-dev` de audio, y no hay sudo no interactivo: lo que compile aquí compilará en el CI sin pasos extra. Decisiones completas y mediciones: `docs/adr/0004-audio-stt.md`.

## Goals / Non-Goals

**Goals:** subtítulos reales del audio del sistema en Windows, macOS y Linux, locales, en tiempo real y sin tocar disco; `EngineKind::Real` completo para audio.

**Non-Goals:** fallback automático texto -> audio en la app (Hito 4); selección de dispositivo, caché de traducción de audio y cuantización avanzada (Hito 5); diarización o timestamps por palabra.

## Decisions

- **STT: Whisper ONNX con `ort`** (Xenova/whisper-base, encoder + decoder "merged" int8, ~78 MB) en vez de `whisper-rs`/whisper.cpp, que compila C++ y exige `cmake`. Reutiliza `ort =2.0.0-rc.13` ya presente. `whisper-tiny` (~42 MB) queda en el manifiesto como alternativa ligera. Medido en WSL, 4 hilos: tiny ~0,4 s y base ~0,8 s por ventana de 2 s (el encoder de 30 s fijos domina), ambos por debajo del tiempo real.
- **Log-mel propio** con `realfft` (Rust puro) replicando `WhisperFeatureExtractor`; solo se calculan los cuadros con audio real.
- **Decodificación voraz con caché KV** (decoder merged con `use_cache_branch`; la caché del encoder se calcula una vez). Se pide solo `last_hidden_state`/`logits`/`present.*` con `OutputSelector`: el export trae atenciones de cientos de MB que no se necesitan. Se suprimen tokens de control y timestamps, se corta por bucles y por límite de tokens según la duración, y se descarta la ventana si `no_speech > 0,6` y `avg_logprob < -1`. Anotaciones (`[BLANK_AUDIO]`, `(música)`) se filtran.
- **Tokenizador byte-level propio**: solo hace falta decodificar (invertir `bytes_to_unicode` sobre `vocab.json`); los ids especiales y de idioma salen de `added_tokens.json`.
- **Parcial/final**: `SpeechToText::push_window(chunk, closes_utterance)` con implementación por defecto que delega en `push` (no rompe fakes ni motores existentes). `WhisperStt` acumula las ventanas de una intervención (`Utterance`, usando `dedupe_overlap` del núcleo): parcial con lo dicho hasta ahora; final al cerrar o a los 8 s. Así se traduce la frase completa y no fragmentos de 2 s.
- **Captura Linux sin `-dev`**: `cpal` exige ALSA (`libasound2-dev`) en Linux, así que se usa `pulseaudio` 0.3.2 (protocolo nativo en Rust puro, sirve también para PipeWire). Se pide al servidor un flujo del monitor de la salida por defecto ya en `f32` mono 16 kHz. La cookie de autenticación se rellena a 256 bytes (WSLg la rechaza si es vacía). `stop` cierra el socket para desbloquear la lectura.
- **Captura Windows/macOS con `cpal` 0.18.2** (dependencia solo para esos destinos): abrir la salida por defecto como entrada activa loopback WASAPI; en macOS 14.6+ crea un tap. El flujo vive en un hilo propio (no es `Send` en todas las plataformas). Mezcla a mono y remuestreo sinc con ventana (`Resampler`) y trozos de 100 ms (`Chunker`).
- **Manifiesto**: tabla `stt` por idioma (opcional, para manifiestos propios) y `required_for_audio`/`required_for_all`; `ModelScope { Text, Audio, All }` en `tr-engine` y parámetro `scope` en el binding, por defecto `text` (compatible).
- **Composición**: `real::audio_parts` repite el orden de `region_parts` (motores compilados, idiomas, modelos listos, y solo entonces cargar modelos y crear la captura); features `stt-whisper` y `audio-loopback` en `tr-adapters` y `tr-engine`.
- **UI**: Ajustes solo muestra estado y descarga de los modelos de audio (ámbito `audio`); sin rediseño.

## Risks / Trade-offs

- [La captura de Windows/macOS no se prueba en WSL] -> compila con `cargo check --target x86_64-pc-windows-gnu`, la lógica compartida (remuestreo, trozos) tiene tests, y `docs/validation/windows-hito-3.md` lista la validación manual.
- [Whisper alucina con ruido o música] -> VAD previo, umbrales de no-habla y filtro de anotaciones; se evalúa con audio real en la validación de Windows.
- [Encoder de 30 s fijos desperdicia CPU en ventanas de 2 s] -> aceptable bajo tiempo real; optimizar (modelo con contexto reducido, cuantización) en el Hito 5.
- [`ort` sigue en RC] -> sin cambios respecto al ADR 0003.
- [`pulseaudio` y `cpal` son dependencias nuevas] -> verificadas y fijadas con `=`; ambas activas (octubre/agosto 2026).
- [Linux: servidor sin monitor por defecto] -> error de captura descriptivo; selección de dispositivo en el Hito 5.

## Open Questions

- Calidad de Whisper base frente a tiny con audio real de series/juegos y ruido de fondo (validación en Windows).
- Permiso de captura de audio del sistema en macOS (TCC) y su mensaje al usuario.
