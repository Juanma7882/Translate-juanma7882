# Proposal

## Why

El repo está vacío. Antes de integrar motores reales (OCR, STT, traducción) hace falta el esqueleto que fija los contratos: puertos en Rust, pipelines probados con fakes y un puente mínimo JS -> Rust -> JS. Hacerlo primero permite desarrollar y testear sin modelos, y valida pronto la decisión más riesgosa (napi-rs dentro de un utility process de Electron). Es el Hito 1 del plan; las decisiones de fondo están en `docs/adr/0001-ui-stack.md` y `docs/adr/0002-architecture.md`.

## What Changes

- Workspace de Rust con `tr-core`, `tr-engine` y `tr-bindings`.
- `tr-core`: tipos (`Region`, `Frame`, `TextBlock`, `AudioChunk`, `Segment`, `Lang`), errores, traits (`ScreenCapture`, `OcrEngine`, `AudioCapture`, `SpeechToText`, `Translator`, `EventSink`, `Clock`) y fakes en el módulo `testing`.
- `tr-core`: `RegionPipeline` (detección de cambio, estabilización, caché LRU en RAM), `AudioPipeline` (VAD por energía, ventanas con solape) y `TextOrAudioPipeline` (state machine con histéresis).
- `tr-engine`: fábrica que arma pipelines desde configuración; en este hito solo con fakes.
- `tr-bindings`: módulo napi-rs con `startRegionTranslation`, `startAudioSubtitles`, `stop` y eventos `onTranslation`, `onSubtitle`, `onError`, `onModelProgress`.
- App Electron mínima con electron-vite y TypeScript: un utility process carga el binding y reenvía eventos; sin ventanas de producto.
- `clippy.toml` con `disallowed-methods` para escritura a disco en todos los crates (el futuro `tr-models` queda exento).
- Fuera de alcance: adaptadores reales, `tr-adapters`, `tr-models`, selector de región, overlay, ajustes, CI y empaquetado.

## Capabilities

### New Capabilities
- `core-ports`: tipos, errores y traits de los puertos, con fakes para tests.
- `region-pipeline`: captura de región -> OCR -> traducción con detección de cambio, estabilización y caché en RAM.
- `audio-pipeline`: audio -> VAD -> STT -> traducción de segmentos finales.
- `text-audio-fallback`: state machine que alterna texto y audio con histéresis.
- `js-bridge`: API chica y estable hacia JS (comandos y eventos) vía napi-rs.
- `desktop-shell`: app Electron mínima con utility process que aloja el binding y recupera caídas.

### Modified Capabilities
<!-- Ninguna: no existen specs previos. -->

## Impact

- Código nuevo: `crates/tr-core`, `crates/tr-engine`, `crates/tr-bindings`, `app/` (electron-vite).
- Dependencias a verificar (versión y mantenimiento) al agregarlas: `thiserror`, `crossbeam-channel`, `lru`, `napi` / `napi-derive`, `electron`, `electron-vite`.
- Entorno: Rust 1.99 y gcc en WSL; Electron se ejecuta en Windows, así que el `.node` debe compilarse para el SO donde corre Electron (ver design.md).
- Regla transversal: nada de contenido (capturas, audio, texto, traducciones) a disco ni a logs.
