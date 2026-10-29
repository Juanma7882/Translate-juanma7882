# Proposal

## Why

El README actual presenta la app pero no demuestra lo que hace distinto al proyecto: la privacidad está en una línea, no hay datos de modelos ni de recursos, y faltan los límites, el uso real y la guía para contribuir. Un lector que decide si instalar una herramienta que lee la pantalla necesita pruebas verificables, no solo promesas. Con los 6 hitos cerrados y sin ninguna release publicada, es el momento de dejar la puerta de entrada completa.

## What Changes

- Sección **Privacidad verificable**: qué garantiza el diseño (todo en RAM, puertos con buffers, lints `print_*`/`dbg_macro`, `disallowed-methods` en `clippy.toml`, test `no_content_leaks`) y cómo comprobarlo.
- Tabla de **modelos y descargas**: modelo, tamaño, origen y SHA-256, generada a partir de `crates/tr-models/models.json`.
- **Huella de recursos**: disco, RAM y CPU en reposo, en un resumen corto con fecha y hardware, enlazado a `docs/perf/hito-5.md`.
- **Por qué existe** y **Límites conocidos** (solo CPU, calidad de Opus-MT en textos largos, OCR según tamaño de letra).
- **Cómo se usa** con atajos de teclado reales (leídos de `app/src/main/shortcuts.ts`) y escenarios «qué pasa cuando…» (región con texto, sin texto, sin modelos, sin red).
- **Diagrama del flujo del pipeline** y **mapa de crates** con enlace a su spec en `openspec/specs/`.
- **Receta para añadir un idioma o un motor**, redactada solo tras validarla contra el código.
- **Estado por plataforma**, **solución de problemas** (Linux: audio, Wayland, `libgbm`), **Agradecimientos** con licencias de modelos y librerías, e **insignia de CI**.
- Archivos nuevos: `LICENSE` (MIT, ya declarada en `Cargo.toml`) y `CONTRIBUTING.md` (flujo OpenSpec y reglas no negociables).
- **Capturas/GIF** de selector, overlay y subtítulos, con ubicación en `docs/media/`.

No se modifica código ni comportamiento de la app.

## Capabilities

### New Capabilities

Ninguna. Es un cambio solo de documentación; por eso `.openspec.yaml` lleva `skip_specs: true`.

### Modified Capabilities

Ninguna.

## Impact

- Archivos: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `docs/media/*` (capturas).
- Sin cambios en crates, app, CI ni dependencias.
- Dependencias externas al cambio: las capturas requieren la app corriendo; la insignia de CI requiere el repo publicado en GitHub; el enlace a Releases requiere la primera release.
