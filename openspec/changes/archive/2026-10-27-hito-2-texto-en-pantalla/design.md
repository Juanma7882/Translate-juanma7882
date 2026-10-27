# Design

## Context

Tras el Hito 1 existen `tr-core` (puertos, pipelines, fakes), `tr-engine` (composición con motores de demostración), `tr-bindings` (napi-rs + `api.js`) y un shell de Electron sin ventanas. Motivación y alcance: ver `proposal.md`; requisitos: ver `specs/`; decisiones de fondo: `docs/adr/0001-ui-stack.md` y `0002-architecture.md`.

Restricciones del entorno (WSL Ubuntu 24.04, sin `sudo` no interactivo): sin `cmake`, sin paquetes `-dev` del sistema, Electron corriendo bajo WSLg con X11 disponible (`DISPLAY=:0`). El `.node` es de Linux. Decisión del usuario: desarrollar en WSL y validar en Windows después.

Investigación de crates (2026-10-27):

| Pieza | Candidato | Estado |
|---|---|---|
| Captura | `xcap` 0.9.8 | Activo (ago 2026), 1,3 M descargas recientes, Apache-2.0. `capture_region` nativo. Wayland no soportado en pantalla completa; en Linux exige `libxcb`, `libxrandr`, `dbus`, `pipewire`, `wayland`, `egl`, `libclang` (paquetes `-dev`). |
| Runtime ML | `ort` 2.0.0-rc.15 (última) / `=2.0.0-rc.13` | Aún en RC pero muy usado (9,4 M descargas recientes). Descarga binarios de ONNX Runtime al compilar. |
| OCR | `oar-ocr` 0.10.2 | Activo (actualizado 2026-10-26), Apache-2.0, PP-OCR v5/v6 (incluye CJK), carga modelos desde memoria, descarga automática opcional. **Fija `ort = "=2.0.0-rc.13"`**, `rust-version 1.95`. |
| OCR alternativa | `ocrs` 0.13.1 | Rust puro (rten), sin dependencias nativas, pero **solo alfabeto latino**. |
| OCR descartada | `tesseract` 0.15.2 / `leptess` | Poco mantenidos (abr 2025 / feb 2023) y necesitan librerías del sistema. |
| Traducción | `ort` + `sentencepiece-model` 0.1.4 + `spm_precompiled` 0.1.4 + Xenova/opus-mt-* ONNX | Modelos publicados (jul 2025), decoder int8 de ~60 MB. Su `tokenizer.json` no sirve para Marian (ver D2). |
| Traducción descartada | `ct2rs` 0.10.2 | Activo, pero compila CTranslate2 (C++) desde fuente: requiere `cmake` y alarga mucho el CI de 4 plataformas. |
| Descargas | `ureq` 3.5.0, `sha2` 0.11.1 | Activos, MSRV ≤ 1.88. |

## Goals / Non-Goals

**Goals:**
- Motores reales de captura, OCR y traducción detrás de los puertos existentes, sin tocar `tr-core`.
- Modelos gestionados (descarga, integridad, progreso) en un único crate con permiso de escritura.
- Interfaz de producto usable de punta a punta y verificada en WSL tanto como sea posible.

**Non-Goals:**
- Audio real, fallback con motores reales, atajo de cambio de modo (Hitos 3-4).
- Rendimiento fino, GPU y beam search avanzado (Hito 5).
- Empaquetado, firma y validación en macOS (Hito 6); validación en Windows queda como lista de verificación entregada, no ejecutada aquí.
- Wayland: se detecta y se informa, no se soluciona.

## Decisions

### D1. OCR: PaddleOCR vía `oar-ocr` sobre `ort`
Elegida por soportar CJK (series y juegos), compartir runtime con la traducción y estar activa. `ocrs` queda como respaldo documentado (solo latino) si el spike falla. *Alternativas descartadas:* Tesseract (crate abandonado, librerías del sistema), escribir el pipeline PaddleOCR a mano sobre `ort` (más código sin beneficio inicial).
**Consecuencia:** `ort` se fija en `=2.0.0-rc.13` para todo el workspace (lo exige `oar-ocr`); se revisa al subir `oar-ocr`.

### D2. Traducción: Opus-MT ONNX sobre `ort` con tokenizador SentencePiece propio
Bucle de decodificación propio (encoder una vez; decoder **sin caché**, recalculando la secuencia en cada paso) con decodificación voraz acotada en longitud; KV-cache y beam search quedan para el Hito 5. Modelos `Xenova/opus-mt-<par>` en int8. Un modelo por par; la lista de pares es el manifiesto. Sesiones de `ort` detrás de un `Mutex` (el puerto exige `Sync`).
**Tokenización:** el `tokenizer.json` de Xenova para Marian no es utilizable con `tokenizers` (el spike lo comprobó), así que se implementa con `sentencepiece-model` (lee `source.spm`), `spm_precompiled` (normalización de SentencePiece) y un Viterbi Unigram propio; los ids salen de `vocab.json`. La entrada vacía no ejecuta el modelo (alucina) y entrada y salida están acotadas.
*Alternativas descartadas:* `ct2rs` (cmake + compilación C++ por plataforma), `tokenizers` (ver arriba), `rust_tokenizers` (abandonado desde 2023), `kitoken` (muy joven). Detalle y mediciones: `docs/adr/0003-ocr-translation-engines.md`.

### D3. Spikes primero, decisión registrada
Antes de escribir los adaptadores se hacen dos spikes en un directorio fuera del workspace: (a) `oar-ocr` con modelos PP-OCR sobre una imagen de prueba en inglés y japonés; (b) traducción Opus-MT en→es. Se miden latencias y se obtienen URLs, tamaños y SHA-256 reales para el manifiesto. El resultado se registra en el ADR 0003. Si un spike falla, se aplica el respaldo (ocrs / ct2rs) **previa consulta al usuario**, porque cambia el alcance de idiomas o el tiempo de compilación.

### D4. `tr-models`: manifiesto, descarga y estado
- Manifiesto en JSON embebido (`models.json`): por modelo `id`, `files[{name, url, sha256, size}]`; tablas `ocr[lang] -> modelos` y `translate[from->to] -> modelos`.
- Descarga con `ureq` a `<dir>/<id>/<archivo>.part`, hash SHA-256 en streaming, verificación y `rename` atómico. Un `.part` residual no cuenta como válido y se sobrescribe. Sin reanudación en este hito.
- Estado por modelo: `Missing | Downloading | Ready`; `Ready` exige archivos presentes **y** huella correcta (se cachea el resultado por tamaño+mtime para no re-hashear 100+ MB en cada arranque).
- Carpeta por defecto: la de datos del usuario del SO, configurable. Es el **único** crate con `#![allow(clippy::disallowed_methods)]`, justificado; el escáner `no_content_leaks` se amplía para `tr-adapters` y verifica que solo `tr-models` escribe.
- Progreso: callback `(model, descargado, total)` que `tr-engine` convierte en `Event::ModelProgress`.

### D5. `tr-adapters`: un módulo por motor, features por motor
`screen-xcap`, `ocr-paddle`, `translate-opus`, todos por defecto. Los adaptadores **leen** modelos de la carpeta (rutas), nunca escriben. `tr-engine` depende de `tr-adapters` y `tr-models`; `tr-core` sigue sin conocerlos. `unsafe` se mantiene prohibido en los adaptadores salvo lo que exijan dependencias (no se espera).

### D6. Captura con `xcap::Monitor::capture_region`
Se resuelve el monitor por `Region::monitor` (índice estable ordenado por posición) y se captura solo el rectángulo, convirtiendo coordenadas de pantalla virtual a relativas del monitor. Errores de `xcap` se mapean a `CoreError::Capture` con mensajes accionables. En Wayland se detecta `XDG_SESSION_TYPE=wayland` y se informa que no está soportado. Frame negro = frame sin texto (no es error).

### D7. Composición
`EngineKind::Real` junto a `Fake`. `Engine::start_region` con `Real` verifica los modelos (`tr-models`) y falla listando los ausentes **antes** de capturar. `EngineConfig` gana `models_dir`. Las descargas se disparan desde un comando aparte (`downloadModels`), no implícitamente al arrancar, para que la UI controle el flujo y el aviso al usuario.

### D8. API de JS
`configure({ engines: 'real' | 'fake', modelsDir })`, `pause()`/`resume()`, `modelStatus(from, to)` y `downloadModels(from, to)` (asíncrona; progreso por `onModelProgress`). La descarga corre en un hilo propio para no bloquear. `api.js` mantiene la garantía de "nada tras `stop()`" y la extiende a la descarga cancelada. Los tipos siguen generándose con `@napi-rs/cli`.

### D9. Electron: ventanas, preload y aislamiento
- Tres renderers (selector, overlay, ajustes) como entradas de `electron-vite`, con `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` y CSP estricta. Un único preload expone una API mínima y tipada por ventana (`contextBridge`); los renderers nunca ven `ipcRenderer`.
- Selector y overlay en TypeScript plano + CSS (ADR 0001); Ajustes con Preact (verificar versión y preset de Vite al agregarlo).
- El proceso principal es el único que habla con el motor (ya existente `EngineHost`) y retransmite eventos a las ventanas.

### D10. Selector de región
Ventana sin marco, transparente, a pantalla completa del monitor elegido, `alwaysOnTop`, sin captura de fondo. Función pura `toPhysicalRegion(dipRect, display)` (escala, origen negativo, monitor) en `shared/`, con tests de tabla (escala 1.0/1.25/1.5/2.0, origen negativo). La última región se guarda en los ajustes.

### D11. Overlay
Ventana transparente, `alwaysOnTop('screen-saver')`, `focusable: false`, `setIgnoreMouseEvents(true, { forward: true })`, `skipTaskbar`, y `setContentProtection(true)` donde exista (Windows/macOS). Posición por defecto calculada por función pura `placeOutside(region, display, size)` (debajo, si no cabe encima). Apariencia por variables CSS; el texto se actualiza con `textContent`. Oculta el texto tras un tiempo sin traducciones nuevas.

### D12. Ajustes y persistencia
`settings.json` en `app.getPath('userData')`, validado con un esquema escrito a mano (sin dependencias), valores por defecto y versión de esquema. Archivo ilegible → valores por defecto + aviso. Es la única escritura a disco desde JS (junto con la carpeta de modelos, que escribe Rust) y no contiene contenido del usuario, solo preferencias y la última región.

### D13. Tray y atajos
`Tray` con menú (elegir región, pausar/reanudar, ajustes, salir) y `globalShortcut` con los atajos configurables; `register` devuelve `false` en conflicto y se informa. En WSLg/Wayland los atajos globales pueden no funcionar: se verifica en Windows (lista de verificación).

### D14. Estrategia de pruebas
- Unitarias puras (manifiesto, descargador contra un servidor HTTP local en el test, conversión de coordenadas, colocación del overlay, ajustes).
- **E2E real en WSL con captura verdadera:** una ventana de Electron muestra un texto conocido en X11/WSLg; `xcap` captura esa región; se reconoce y traduce y el overlay la muestra. Esto valida captura+OCR+traducción sin depender de Windows.
- Pruebas con modelos reales marcadas con `#[ignore]`/variable `TR_REAL_MODELS=1` (los modelos pesan cientos de MB y requieren red); se ejecutan en esta sesión y en CI con caché.
- Lo no verificable en WSL (clic a través, siempre encima, atajos globales, exclusión de captura, escala real, juegos en ventana sin bordes) va a `docs/validation/windows-hito-2.md`.

### Desviaciones y hallazgos de la implementación
- **Captura bajo WSLg:** `xcap` no puede capturar en Wayland ni en el X11 de WSLg (`BadMatch`); toda prueba de captura real (incluida la E2E de Electron, `TR_SMOKE=e2e`) corre sobre Xvfb vía `scripts/with-xvfb.sh`. Los tests con ventana X de `real_pipeline` se serializan con un cerrojo porque comparten pantalla.
- **API de bindings ampliada:** `configure` acepta `engines`, `modelsDir` y `manifestPath` (manifiesto alternativo para espejos y pruebas herméticas); se añaden `pause`/`resume`, `modelCatalog()` (idiomas con OCR y pares de traducción para poblar los selectores), `modelStatus` y `downloadModels` (async). `start_*` construye la nueva tubería antes de detener la anterior y `configure` valida todo antes de tocar estado.
- **Progreso de descarga:** la promesa de la tarea asíncrona y los eventos del `ThreadsafeFunction` llegan por canales distintos; `api.js` espera (`settleProgress`) a haber entregado todos los eventos emitidos antes de resolver.
- **Preloads:** con sandbox deben ser un único archivo; no se comparten chunks y se usa `import type` + `satisfies typeof Channel.x`. `isolatedEntries` de electron-vite se descartó (falla sin TTY).
- **Ensamblaje:** `AppShell` (bandeja, atajos, overlay, primer uso) recibe bandeja/atajos/notificaciones por inyección; `ModelsService` solo reconfigura el motor cuando no hay una traducción en marcha. Primer uso: un aviso `models-missing` abre Ajustes y, al terminar la descarga, se reintenta la traducción pendiente.
- **Pruebas de humo añadidas:** `settings` (UI real + servidor local de descargas con fallo y reintento), `shell` (bandeja, atajos, primer uso) y `e2e` (motores reales).

## Risks / Trade-offs

- [`xcap` en Linux exige paquetes `-dev` y `sudo`] → primera tarea: el usuario ejecuta un solo `apt install`; si no es posible, el adaptador se desarrolla tras su feature flag con tests de mapeo y la captura real se valida en Windows.
- [`ort` sigue en RC y `oar-ocr` lo fija en rc.13] → versión exacta fijada para todo el workspace; el spike valida que carga modelos reales; se revisa al subir `oar-ocr`.
- [`ort` descarga ONNX Runtime al compilar] → requiere red en el build; en CI se cachea. Los binarios por plataforma se validan en el Hito 6.
- [Calidad de Opus-MT voraz en frases largas o subtítulos con ruido] → acotar longitud, normalizar entrada, medir en el spike; beam search en el Hito 5 si hace falta.
- [Modelos grandes en el primer uso] → aviso con tamaño total, progreso y verificación; `Ready` cacheado para no re-hashear.
- [Overlay legible por el OCR] → ubicación fuera de la región + exclusión de captura donde exista; advertencia si se superpone.
- [Atajos/transparencia/click-through distintos en WSLg y Wayland] → lista de verificación en Windows; no se promete esa parte aquí.
- [Alcance grande del cambio] → tareas ordenadas en dos fases (motores y modelos; interfaz); cada grupo es verificable por separado.
- [CJK limitado por los modelos del manifiesto] → el manifiesto trae latino y los conjuntos CJK que el spike confirme; ampliar es agregar entradas.

## Open Questions

- Conjuntos de modelos CJK incluidos en el manifiesto inicial y pares de traducción más allá de en↔es: se concretan con los datos del spike sin cambiar specs ni tareas.
- Valores por defecto de tiempos del overlay (ocultar tras N segundos) y de región mínima: se ajustan con uso real.
- Si la validación en Windows exige cambios en la ventana overlay, se abre un cambio posterior.
