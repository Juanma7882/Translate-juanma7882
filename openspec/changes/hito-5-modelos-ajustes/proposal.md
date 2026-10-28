# Proposal

## Why

Hasta el Hito 4 el producto traduce texto y audio, pero la gestión de modelos es mínima (solo descargar) y la ventana de Ajustes es una página larga sin estructura. Para un uso cotidiano faltan: saber cuánto espacio ocupa cada modelo y poder borrarlo, cancelar o reanudar una descarga de cientos de MB, elegir dónde viven los modelos, más pares de idiomas, ajustes ordenados y accesibles, importar/exportar preferencias y un overlay personalizable (colores con contraste legible, posición manual, límite de líneas). Además el Hito 5A (rendimiento) necesita un punto de entrada desde JS para sus parámetros sin que ambos hitos se pisen.

## What Changes

- `tr-models` (único que escribe/borra disco): uso de disco por modelo, borrado seguro (solo dentro de la carpeta de modelos, solo archivos del manifiesto, nunca con una descarga en curso), descargas reanudables con `Range` (el parcial `.part` se conserva al cancelar o cortarse la red y se verifica el SHA-256 final) y validación de la carpeta de modelos.
- `tr-engine`: inventario de modelos (rol, idiomas, bytes en disco, parciales), borrado, cancelación y validación de carpeta expuestos en `Models`; `EngineConfig.performance` (`intra_threads`, `beam_width`) opcional para que 5A lo consuma.
- `tr-bindings`/`api.js`: `modelInventory`, `deleteModel`, `cancelModelDownload`, `validateModelsDir` y `EngineOptions.performance` validado (`intraThreads`, `beamWidth`, `cacheCapacity`). El borrado se rechaza con una traducción en marcha.
- Manifiesto: nuevos pares Opus-MT Xenova (en<->fr, en<->de, en<->it, es<->fr), con URL fijada por commit, tamaños y SHA-256 medidos descargando, y probados con una frase real.
- App: Ajustes reorganizados en pestañas (General, Idiomas y modelos, Apariencia, Atajos, Avanzado) con restablecer valores, importar/exportar preferencias (JSON solo de ajustes), validación en línea, ARIA/foco/teclado, tema claro/oscuro del sistema y mensajes en español; gestión de modelos (espacio, borrar, cancelar, reanudar, carpeta).
- Overlay: color de texto y de fondo con contraste mínimo 4,5:1 validado, límite de líneas y posición manual arrastrable (modo "mover" con la ventana interactiva temporalmente).
- Los ajustes de rendimiento (`performance`) viajan a `configure`; se ignoran sin romper si el motor aún no los usa.
- ADR 0007 y `docs/validation/windows-hito-5.md`.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `model-management`: uso de disco, borrado seguro, cancelación, reanudación y carpeta validada.
- `text-translation`: nuevos pares de idiomas en el manifiesto.
- `js-bridge`: inventario, borrado, cancelación, validación de carpeta y opciones de rendimiento.
- `settings-window`: pestañas, restablecer, importar/exportar, validación en línea, accesibilidad, tema.
- `translation-overlay`: colores con contraste, límite de líneas y posición manual arrastrable.
- `app-integration`: borrado bloqueado durante una sesión y carpeta de modelos validada.

## Impact

- Crates: `tr-models`, `tr-engine` (models.rs y, en engine.rs, solo `performance`), `tr-bindings`. No se tocan `tr-core` ni `tr-adapters`.
- App: `shared/settings.ts`, `shared/ipc.ts`, `shared/protocol.ts`, `main/*` (models-service, settings-ipc, overlay-controller, windows, engine-options), preloads de Ajustes y overlay, renderers de Ajustes y overlay, smokes.
- Sin dependencias nuevas.
- Lo no verificable en WSL (diálogo nativo de carpeta, arrastre con ratón real, tema del sistema, unidades de red en Windows) va a `docs/validation/windows-hito-5.md`.
