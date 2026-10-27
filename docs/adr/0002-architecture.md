# ADR 0002 — Arquitectura del núcleo y del puente

- Estado: aceptado
- Fecha: 2026-10-27

## Decisión

### Workspace

```
tr-core        traits, tipos, pipelines, state machine, caché, fakes (módulo testing)
tr-adapters    un módulo por motor, cada uno tras un feature flag
tr-models      descarga, verificación SHA-256 y progreso (único módulo que escribe a disco)
tr-engine      composition root: config + SO -> pipeline
tr-bindings    napi-rs; superficie chica hacia JS
```

- `core` se renombra a `tr-core` para no chocar con `core` de la librería estándar.
- `tr-engine` es el único que conoce núcleo y adaptadores; `tr-core` nunca importa un adaptador.
- Los fakes viven en `tr-core::testing` (sin dependencias).
- Los adaptadores usan feature flags por motor.

### Concurrencia

- Traits síncronos, hilos y canales acotados. **Sin tokio en el núcleo**: el trabajo es de CPU, y así se prueba con fakes y reloj falso.
- Backpressure "último gana": canales de capacidad 1-2, se descartan frames viejos.
- Eventos por trait `EventSink`; el reloj es un trait `Clock` inyectable.

### Datos

- JS nunca toca píxeles ni audio: captura, OCR y traducción ocurren dentro de Rust. JS envía `rect` y recibe texto. Esto cumple "todo en RAM" por construcción.
- Tipos: `Region`, `Frame` (RGBA, `Vec<u8>`), `TextBlock`, `AudioChunk` (f32 mono 16 kHz), `Segment`, `Lang`. Errores con `thiserror`.

### Pipelines

- **RegionPipeline**: capturar -> detección de cambio -> OCR -> normalizar -> estabilizar (2 frames iguales) -> caché LRU `(texto, from, to)` -> traducir -> evento.
- **AudioPipeline**: chunks -> VAD por energía -> ventanas con solape -> STT -> parcial/final -> traducir finales -> evento.
- **TextOrAudioPipeline**: state machine pura (`Text`, `Audio`, `Paused`). Texto a audio tras N s sin OCR; audio a texto cuando el OCR vuelve a encontrar texto, con histéresis. Solo captura audio en modo `Audio`.

### Electron

```
Renderers -> Main (ventanas, atajos, tray, permisos) -> UtilityProcess -> tr-bindings (.node) -> tr-engine
```

- El overlay recibe eventos por `MessagePort` directo desde el utility process.
- Conversión DIP -> píxeles físicos + id de monitor en `main`, con función probada.
- Un pánico de Rust tira solo el utility process; `main` lo reinicia y avisa.

### Overlay y captura (anti-bucle)

El overlay sobre la región capturada haría que el OCR lea su propia traducción.
- Por defecto el overlay se coloca **fuera** de la región.
- `setContentProtection(true)` donde exista (Windows, macOS). En Linux no funciona: solo vale la regla de posición.

### Disco

- Nunca se loguea contenido (texto, audio, traducciones), solo metadatos (longitud, latencia).
- `clippy.toml` con `disallowed-methods` (`std::fs::write`, `File::create`, etc.) en todos los crates salvo `tr-models`.
- Vigilar volcados de fallos (crashpad) y mensajes de pánico.

## Alcance del Hito 1

`tr-core`, `tr-engine`, `tr-bindings`: traits, tipos, fakes, pipelines con tests, caché y detección de cambio. Binding mínimo `startRegionTranslation` / `stop` con eventos (JS -> Rust -> JS). Electron mínimo con electron-vite y utility process, sin ventanas de producto. Adaptadores reales desde el Hito 2.

## Ajustes surgidos al implementar el Hito 1

- La espera entre capturas es interrumpible, de modo que `stop()` no depende del intervalo.
- El hook de pánico vive en `tr-core::panic_hook` (testeable); el binding solo lo instala.
- Capa `api.js` sobre el módulo napi: varios suscriptores y garantía de "nada tras `stop()`" (los eventos ya encolados hacia JS no se pueden retirar desde Rust).
- API de JS ampliada con `configure()` y `onModeChanged` (ver `openspec/changes/hito-1-esqueleto/specs/js-bridge`).
- Prohibir imprimir (lints `print_*`, `dbg_macro`) sustituye a "vigilar logs": es una garantía por construcción.
- `rust-version = 1.88` por el MSRV de napi 3.15.

## Pendiente

Wayland y captura en juegos: spike en el Hito 2. Verificar versión y mantenimiento de cada crate al agregarlo.
