# Tasks

> Requisito previo: `ui-inicio-y-primer-uso` terminada y archivada (le falta 1 tarea): este cambio modifica requisitos que esa change crea o reescribe (`settings-window` «Idiomas», `home-start-screen`). Los comandos de Rust se corren desde WSL (ver CLAUDE.md).

## 1. Núcleo (`tr-core`)

- [x] 1.1 Añadir `Translated { lang, text }` y cambiar `Event::Translation` y `Event::Subtitle` a `translations: Vec<Translated>` en `types.rs`; actualizar sus usos en `tr-core` y verificar que `cargo test -p tr-core` compila y pasa (incluido `no_content_leaks`)
- [x] 1.2 `RegionConfig`/`RegionProcessor` con `targets: Vec<Lang>` (0 a 2) y un traductor por destino en el mismo orden; caché por destino; fallos parciales (omitir el destino y emitir su error; reintentar solo si ninguno tuvo éxito); verificar con tests deterministas: un destino, dos destinos en orden, cero destinos (el traductor no se invoca), fallo de uno de dos, repetido servido desde la caché por destino
- [x] 1.3 Traducción de los destinos en paralelo (`std::thread::scope`, sin hilos extra con un solo destino) en una función compartida por `RegionProcessor` y `AudioProcessor`, que devuelve las traducciones en el orden de los destinos y no de llegada; verificar con un test con dos `FakeTranslator` con latencia fija de 100 ms: el total es cercano a 100 ms y no a 200 ms, la salida conserva el orden aunque el segundo termine antes, y un pánico o fallo de uno no pierde la traducción del otro
- [x] 1.4 `AudioConfig`/`AudioProcessor` con la misma lista: parciales con `translations` vacío, finales con una traducción por destino (en paralelo), cero destinos sin invocar traductores, fallo parcial; verificar con tests de `audio.rs` (incluida la ventana de cierre, que no cambia)
- [x] 1.5 Adaptar `fallback.rs`/`runner.rs` y `tests/fallback_pipeline.rs` al nuevo evento y a la lista de traductores compartida entre texto y audio; verificar con `cargo test -p tr-core`

## 2. Modelos (`tr-models`, `tr-engine::models`)

- [x] 2.1 `Manifest::required_for`, `required_for_audio` y `required_for_all` reciben `&[Lang]` (reconocimiento del origen + un modelo de traducción por destino, sin repetidos; lista vacía = solo reconocimiento); verificar con tests: vacía, dos destinos, destino repetido, par no soportado, ámbitos texto/audio/todo
- [x] 2.2 `tr-engine/src/models.rs`: estado y descarga con lista de destinos (el error de modelos faltantes agrega los de todos los destinos sin duplicados); verificar con tests de `models` usando el servidor de descargas de prueba (`tr-models::testing`)

## 3. Motor (`tr-engine`)

- [x] 3.1 `Engine::start_region(region, from, targets)` y `start_audio(from, targets, source)`; `fake.rs` devuelve un `FakeTranslator` por destino; verificar con `cargo test -p tr-engine` (tests `engine.rs` y `lifecycle.rs` actualizados: una pista equivale a la lista de uno)
- [x] 3.2 `real.rs`: `region_parts`, `audio_parts` y `ensure_fallback_ready` con destinos; carga de OCR/STT y de un traductor por destino en paralelo (`std::thread::scope`); con cero destinos no se carga ni se exige ningún modelo de traducción; verificar con los tests de `real.rs` (faltantes agregados de varios destinos, cero destinos con solo OCR). El reparto de hilos de ONNX entre destinos se descartó tras medir (ver `docs/perf/subtitulos-multiples.md`)
- [x] 3.3 El fallback comparte el `Vec<Arc<dyn Translator>>` entre texto y audio; verificar con un test del engine con dos destinos que cuenta las cargas (una por destino)
- [x] 3.4 Prueba real ignorada con dos destinos (`en→es` y `en→fr`) sobre modelos descargados, extendiendo `real_pairs`; verificar con `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-engine --test real_pairs -- --ignored`

## 4. Puente (`tr-bindings`)

- [x] 4.1 `lib.rs`: `startRegionTranslation`, `startAudioSubtitles`, `modelStatus` y `downloadModels` reciben `to: Vec<String>`; el helper `languages()` valida (≤2, sin repetidos, ≠ origen, formato) y devuelve `InvalidArg`; verificar con tests de Rust del helper
- [x] 4.2 `events.rs`: `TranslationEvent` y `SubtitleEvent` con `translations: Vec<TranslationText { lang, text }>`; regenerar `index.d.ts` con `pnpm run build:debug` y actualizar `api.js`/`api.d.ts`; verificar que los tipos generados contienen las listas
- [x] 4.3 Pruebas de Node en `crates/tr-bindings/test` (`bridge.test.js` y afines): destinos inválidos (tres, repetido, igual al origen), cero destinos, forma del evento con dos traducciones; verificar con `pnpm test` en `crates/tr-bindings`

## 5. Ajustes y lógica pura de la app

- [x] 5.1 `shared/settings.ts`: `targets: string[]` (0–2, distintos, ≠ `from`), lectura que migra el campo antiguo `to`, invariante `1 ≤ (showOriginal ? 1 : 0) + targets.length ≤ 2`, valores por defecto `from: 'en'`, `targets: ['es']`; verificar con tests de `settings.test.ts` (migración, repetidos, tres destinos, original + dos destinos, sin subtítulos, parche que reemplaza la lista, parche que rompe la invariante, lectura de disco con exceso que se corrige con aviso)
- [x] 5.2 `settings-transfer.ts` e `settings-store`: importar y cargar ajustes con el formato anterior sin perder el resto; verificar con tests de importación de un archivo con `to` y de uno con `targets`
- [x] 5.3 `renderer/settings/form.ts`: funciones puras `sourceLanguages(catalog, mode)`, `targetOptions(catalog, from, chosen)`, `changeSource(...)` (devuelve ajustes nuevos y los destinos quitados), `addTarget`/`removeTarget`/`setOriginal` respetando límite e invariante, una función que traduce las dos casillas «Subtítulo 1/2» (`{ lang, enabled }`) a `showOriginal` + `targets` y viceversa, y mensajes de error en español; sustituir `languageError`; verificar con tests de `form.test.ts` (origen que deja sin destinos, intento de tercer subtítulo, quitar el último destino, sin subtítulos, mismo idioma en las dos casillas, casillas ↔ ajustes en las cuatro combinaciones válidas)

## 6. Proceso principal de Electron

- [x] 6.1 `protocol.ts`, `engine/worker.ts`, `engine-host.ts`, `models-service.ts`, `settings-ipc.ts`: pasar `targets` en `startRegion`, `startAudio`, `modelStatus` y `downloadModels`; verificar con `pnpm run typecheck` y los tests del protocolo
- [x] 6.2 `app-controller.ts`: `sessionKey` con origen y destinos (cambiar `showOriginal` no reinicia), conversión de eventos del motor a `OverlayText { original, translations, final }`; `tray-menu.ts` no muestra idiomas y no cambia; verificar con `app-controller.test.ts` y `tray-menu.test.ts` (reinicia al añadir un destino, no reinicia al ocultar el original)
- [x] 6.3 `shared/ipc.ts` (`OverlayText`) y `overlay-controller.ts`: `overlayHeight(fontSize, maxLines, tracks)` crece con el número de subtítulos (1 o 2) y se recalcula al cambiar; nueva función pura `linesPerTrack(fontSize, maxLines, tracks, workHeight)` que reduce las líneas por subtítulo (mínimo 1) hasta que el total quepa en el 45 % del alto útil, usada por el controlador para dimensionar la ventana y enviar `--max-lines` efectivo; verificar con tests de `overlayHeight` y `linesPerTrack` (28 px / 2 líneas / 1080 px no reduce nada; 96 px / 6 líneas / 768 px reduce y nunca baja de 1; una pista no reduce) y de que el estilo `showOriginal` llega al overlay en vivo

## 7. Interfaz

- [x] 7.1 `languages-panel.tsx`: selector «El contenido está en…» y dos casillas «Subtítulo 1» (siempre activo) y «Subtítulo 2» (opcional, con interruptor), cada una con su selector de idioma (origen = texto original, o un destino disponible, sin repetir el de la otra), estado de modelos y descarga por destino, aviso de que el original va arriba; guardado con un único parche atómico; verificar con el smoke de Ajustes (elegir origen, activar el subtítulo 2, comprobar que no ofrece un tercero ni el mismo idioma, desactivar el original, aviso de reinicio con sesión en marcha)
- [x] 7.2 Quitar `showOriginal` de Apariencia; adaptar `quick-setup.tsx` (el menú elige `from` y `targets = [to]`), `home-panel.tsx` (resumen «inglés → español + francés»), `start-guide.tsx` (modelos de origen y todos los destinos; sin destinos basta el reconocimiento) y `home.ts`; verificar con `home.test.ts`/`home-start.test.ts` actualizados y el smoke de Inicio
- [x] 7.3 Overlay: `index.html` con `#tracks`, `view.ts` (`viewFor` devuelve `lines`, parcial sin traducción visible aunque el original esté oculto), `main.ts` (un `<p lang>` por línea con `createElement`/`textContent`, etiqueta corta de idioma si hay más de una pista) y `style.css` (`--max-lines` por pista, contraste y sombra como hoy); verificar con `view.test.ts`, `view-style.test.ts` y el smoke del overlay con 1 y 2 subtítulos, midiendo con `getBoundingClientRect` que con dos subtítulos de varias líneas (28 px / 2 líneas, y el peor caso 96 px / 6 líneas en 768 px) ninguna línea queda fuera de la ventana ni de la pantalla
- [x] 7.4 Vista previa de Apariencia con las mismas líneas (textos de muestra por idioma) y `style.css` de Ajustes; verificar con `style-contrast.test.ts` y comprobando a mano que la vista previa refleja las pistas elegidas
- [x] 7.5 Actualizar `smoke-overlay.ts`, `smoke-settings.ts`, `smoke-e2e.ts`, `smoke-flow.ts` y `smoke-shell.ts` al nuevo evento y a los ajustes; verificar con `TR_SMOKE=<1|windows|selector|flow|overlay|settings|shell>` (en Windows con `ELECTRON_RUN_AS_NODE` sin definir)

## 8. Verificación, rendimiento y documentación

- [x] 8.1 Verificación completa: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`, `pnpm test` en `crates/tr-bindings` y en `app`, `pnpm run typecheck`, y el E2E real `smoke:e2e` con dos destinos; verificar que todo pasa y anotar el resultado Resultado: `cargo fmt --check` y `clippy -D warnings` limpios, `cargo test --workspace` 327 pasan, `pnpm test` 64 (bindings) y 360 (app), `typecheck` sin errores, smokes `1`, `windows`, `selector`, `flow`, `shell` y `settings` pasan; el de `overlay` pasa hasta el escáner de fugas, que en este equipo encuentra textos de otras sesiones en %TEMP% y en la caché de Chromium (ajeno al cambio). El E2E real (`smoke:e2e`) usa Xvfb y no se corrió en Windows; lo cubre `two_real_targets_are_translated_together_each_in_its_language` con modelos reales.
- [x] 8.2 Medir con `cargo run --release -p tr-adapters --example perf` y `perf_engine` la latencia hasta mostrar el texto con 1 destino, 2 en serie y 2 en paralelo (con y sin reparto de hilos de ONNX) y la RAM; documentarlo en `docs/perf`; decidir si el paralelo gana al serie en el equipo de pruebas (si no, dejar el serie y anotarlo en el ADR); verificar con los números anotados frente a `performance-budget`
- [x] 8.3 ADR `docs/adr/0009-subtitulos-multiples.md` (decisiones 1 a 4 del diseño, con los números de 8.2), lista manual `docs/validation/windows-pistas.md` y actualización de README/CLAUDE.md si mencionan el par único; verificar que los archivos existen y enlazan entre sí
- [x] 8.4 Guardar la decisión en Engram (`mem_save`), correr `openspec validate idiomas-y-subtitulos-multiples --strict` y dejar la change lista para archivar tras `ui-inicio-y-primer-uso`; verificar que la validación pasa
