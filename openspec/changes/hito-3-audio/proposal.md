# Proposal

## Why

Hasta el Hito 2 el motor traduce texto en pantalla, pero el pipeline de audio (`AudioPipeline`) solo corre con motores de demostración: `EngineKind::Real` rechaza `startAudioSubtitles` ("not available yet"). Sin captura del audio del sistema ni reconocimiento de voz reales no hay subtítulos de vídeos o llamadas, y el Hito 4 (fallback texto -> audio) no tiene nada real que conmutar.

## What Changes

- Reconocimiento de voz local con Whisper (base, int8) en ONNX sobre el mismo `ort` que el OCR y la traducción: espectrograma log-mel propio (`realfft`), decodificación voraz con caché KV, tokenizador byte-level propio, filtro de no-habla y acumulación de ventanas en frases (parcial -> final).
- Captura del audio del sistema: Linux por protocolo PulseAudio/PipeWire en Rust puro (`pulseaudio`, sin paquetes `-dev`), Windows (WASAPI loopback) y macOS (CoreAudio tap, 14.6+) con `cpal`; mezcla a mono y remuestreo a 16 kHz.
- `tr-core`: el puerto `SpeechToText` gana `push_window(chunk, closes_utterance)` con implementación por defecto (compatible hacia atrás); el procesador de audio lo usa.
- `tr-models`: el manifiesto añade la tabla `stt` y los modelos `stt-whisper-base` y `stt-whisper-tiny`; nuevos ámbitos de modelos (`text`, `audio`, `all`).
- `tr-engine`: `EngineKind::Real` construye captura + STT + traducción para `start_audio` y para el fallback.
- `tr-bindings`: `modelStatus`/`downloadModels` aceptan `scope`; `modelCatalog` expone `sttLanguages`; `startAudioSubtitles` funciona con motores reales.
- UI de Ajustes: solo lo mínimo para ver y descargar los modelos de audio.
- ADR 0004 (decisión de STT y captura) y guía de validación manual en Windows.

## Capabilities

### New Capabilities
- `speech-recognition`: transcripción local de voz con Whisper, parciales/finales y descarte de no-habla.
- `system-audio-capture`: captura en memoria del audio que suena por los altavoces, normalizado a mono 16 kHz.

### Modified Capabilities
- `audio-pipeline`: el STT recibe si la ventana cierra la intervención.
- `model-management`: modelos de voz y ámbitos de consulta/descarga.
- `engine-composition`: motores reales de audio.
- `js-bridge`: parámetro `scope` y `sttLanguages`.

## Impact

- Crates: `tr-core` (puerto), `tr-models` (manifiesto), `tr-adapters` (módulos `stt`, `audio`), `tr-engine`, `tr-bindings`; `app` (Ajustes, mínimo).
- Dependencias nuevas (versión fijada, verificadas 2026-10-27): `realfft =3.5.1`, `cpal =0.18.2` (solo Windows/macOS), `pulseaudio =0.3.2` (solo Linux).
- Descarga adicional de ~78 MB (Whisper base) por instalación que use audio.
- La captura loopback de Windows/macOS no se puede verificar en WSL: ver `docs/validation/windows-hito-3.md`.
