# Tasks

> Requisito previo: `ui-inicio-y-primer-uso` terminada y archivada (le falta 1 tarea): este cambio modifica requisitos que esa change crea o reescribe (`settings-window` «Idiomas», `home-start-screen`). Los comandos de Rust se corren desde WSL (ver CLAUDE.md).

## 1. Núcleo (`tr-core`)

- [ ] 1.1 Añadir `Translated { lang, text }` y cambiar `Event::Translation` y `Event::Subtitle` a `translations: Vec<Translated>` en `types.rs`; actualizar sus usos en `tr-core` y verificar que `cargo test -p tr-core` compila y pasa (incluido `no_content_leaks`)
- [ ] 1.2 `RegionConfig`/`RegionProcessor` con `targets: Vec<Lang>` y un traductor por destino en el mismo orden; caché por destino; fallos parciales (omitir el destino y emitir su error; reintentar solo si ninguno tuvo éxito); verificar con tests deterministas: un destino, dos destinos en orden, cero destinos (el traductor no se invoca), fallo de uno de dos, repetido servido desde la caché por destino
- [ ] 1.3 `AudioConfig`/`AudioProcessor` con la misma lista: parciales con `translations` vacío, finales con una traducción por destino, cero destinos sin invocar traductores, fallo parcial; verificar con tests de `audio.rs` (incluida la ventana de cierre, que no cambia)
- [ ] 1.4 Adaptar `fallback.rs`/`runner.rs` y `tests/fallback_pipeline.rs` al nuevo evento y a la lista de traductores compartida entre texto y audio; verificar con `cargo test -p tr-core`

## 2. Modelos (`tr-models`, `tr-engine::models`)

- [ ] 2.1 `Manifest::required_for`, `required_for_audio` y `required_for_all` reciben `&[Lang]` (reconocimiento del origen + un modelo de traducción por destino, sin repetidos; lista vacía = solo reconocimiento); verificar con tests: vacía, dos destinos, destino repetido, par no soportado, ámbitos texto/audio/todo
- [ ] 2.2 `tr-engine/src/models.rs`: estado y descarga con lista de destinos (el error de modelos faltantes agrega los de todos los destinos sin duplicados); verificar con tests de `models` usando el servidor de descargas de prueba (`tr-models::testing`)

## 3. Motor (`tr-engine`)

- [ ] 3.1 `Engine::start_region(region, from, targets)` y `start_audio(from, targets, source)`; `fake.rs` devuelve un `FakeTranslator` por destino; verificar con `cargo test -p tr-engine` (tests `engine.rs` y `lifecycle.rs` actualizados: una pista equivale a la lista de uno)
- [ ] 3.2 `real.rs`: `region_parts`, `audio_parts` y `ensure_fallback_ready` con destinos; carga de OCR/STT y de un traductor por destino en paralelo (`std::thread::scope`); con cero destinos no se carga ni se exige ningún modelo de traducción; verificar con los tests de `real.rs` (faltantes agregados de varios destinos, cero destinos con solo OCR)
- [ ] 3.3 El fallback comparte el `Vec<Arc<dyn Translator>>` entre texto y audio; verificar con un test del engine con dos destinos que cuenta las cargas (una por destino)
- [ ] 3.4 Prueba real ignorada con dos destinos (`en→es` y `en→fr`) sobre modelos descargados, extendiendo `real_pairs`; verificar con `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-engine --test real_pairs -- --ignored`

## 4. Puente (`tr-bindings`)

- [ ] 4.1 `lib.rs`: `startRegionTranslation`, `startAudioSubtitles`, `modelStatus` y `downloadModels` reciben `to: Vec<String>`; el helper `languages()` valida (≤3, sin repetidos, ≠ origen, formato) y devuelve `InvalidArg`; verificar con tests de Rust del helper
- [ ] 4.2 `events.rs`: `TranslationEvent` y `SubtitleEvent` con `translations: Vec<TranslationText { lang, text }>`; regenerar `index.d.ts` con `pnpm run build:debug` y actualizar `api.js`/`api.d.ts`; verificar que los tipos generados contienen las listas
- [ ] 4.3 Pruebas de Node en `crates/tr-bindings/test` (`bridge.test.js` y afines): destinos inválidos (cuatro, repetido, igual al origen), cero destinos, forma del evento con dos traducciones; verificar con `pnpm test` en `crates/tr-bindings`

## 5. Ajustes y lógica pura de la app

- [ ] 5.1 `shared/settings.ts`: `targets: string[]` (0–3, distintos, ≠ `from`), lectura que migra el campo antiguo `to`, invariante «al menos una pista» (`showOriginal || targets.length > 0`), valores por defecto `from: 'en'`, `targets: ['es']`; verificar con tests de `settings.test.ts` (migración, repetidos, cuatro destinos, sin pistas, parche que reemplaza la lista, parche que rompe la invariante)
- [ ] 5.2 `settings-transfer.ts` e `settings-store`: importar y cargar ajustes con el formato anterior sin perder el resto; verificar con tests de importación de un archivo con `to` y de uno con `targets`
- [ ] 5.3 `renderer/settings/form.ts`: funciones puras `sourceLanguages(catalog, mode)`, `targetOptions(catalog, from, chosen)`, `changeSource(...)` (devuelve ajustes nuevos y los destinos quitados), `addTarget`/`removeTarget`/`setOriginal` respetando límite e invariante, y mensajes de error en español; sustituir `languageError`; verificar con tests de `form.test.ts` (origen que deja sin destinos, intento de cuarto destino, quitar el último destino, sin pistas)

## 6. Proceso principal de Electron

- [ ] 6.1 `protocol.ts`, `engine/worker.ts`, `engine-host.ts`, `models-service.ts`, `settings-ipc.ts`: pasar `targets` en `startRegion`, `startAudio`, `modelStatus` y `downloadModels`; verificar con `pnpm run typecheck` y los tests del protocolo
- [ ] 6.2 `app-controller.ts`: `sessionKey` con origen y destinos (cambiar `showOriginal` no reinicia), conversión de eventos del motor a `OverlayText { original, translations, final }`; `tray-menu.ts` con el resumen de idiomas; verificar con `app-controller.test.ts` y `tray-menu.test.ts` (reinicia al añadir un destino, no reinicia al ocultar el original)
- [ ] 6.3 `shared/ipc.ts` (`OverlayText`) y `overlay-controller.ts`: `overlayHeight(fontSize, maxLines, tracks)` crece con el número de pistas y se recalcula al cambiar; verificar con un test de `overlayHeight` y de que el estilo `showOriginal` llega al overlay en vivo

## 7. Interfaz

- [ ] 7.1 `languages-panel.tsx`: selector «El contenido está en…», lista de pistas de traducción (añadir, quitar, estado de modelos y descarga por destino, límite de tres), casilla «Mostrar el texto original»; guardado con un único parche atómico; verificar con el smoke de Ajustes (elegir origen, añadir dos destinos, intentar el cuarto, quitar el original, aviso de reinicio con sesión en marcha)
- [ ] 7.2 Quitar `showOriginal` de Apariencia; adaptar `quick-setup.tsx` (el menú elige `from` y `targets = [to]`), `home-panel.tsx` (resumen «inglés → español + francés»), `start-guide.tsx` (modelos de origen y todos los destinos; sin destinos basta el reconocimiento) y `home.ts`; verificar con `home.test.ts`/`home-start.test.ts` actualizados y el smoke de Inicio
- [ ] 7.3 Overlay: `index.html` con `#tracks`, `view.ts` (`viewFor` devuelve `lines`, parcial sin traducción visible aunque el original esté oculto), `main.ts` (un `<p lang>` por línea con `createElement`/`textContent`, etiqueta corta de idioma si hay más de una pista) y `style.css` (`--max-lines` por pista, contraste y sombra como hoy); verificar con `view.test.ts`, `view-style.test.ts` y el smoke del overlay con 1, 2 y 3 pistas
- [ ] 7.4 Vista previa de Apariencia con las mismas líneas (textos de muestra por idioma) y `style.css` de Ajustes; verificar con `style-contrast.test.ts` y comprobando a mano que la vista previa refleja las pistas elegidas
- [ ] 7.5 Actualizar `smoke-overlay.ts`, `smoke-settings.ts`, `smoke-e2e.ts`, `smoke-flow.ts` y `smoke-shell.ts` al nuevo evento y a los ajustes; verificar con `TR_SMOKE=<1|windows|selector|flow|overlay|settings|shell>` bajo `scripts/with-xvfb.sh`

## 8. Verificación, rendimiento y documentación

- [ ] 8.1 Verificación completa: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`, `pnpm test` en `crates/tr-bindings` y en `app`, `pnpm run typecheck`, y el E2E real `smoke:e2e` con dos destinos; verificar que todo pasa y anotar el resultado
- [ ] 8.2 Medir con `cargo run --release -p tr-adapters --example perf` y `perf_engine` la latencia de 1, 2 y 3 destinos y la RAM; documentarlo en `docs/perf` y decidir si la traducción secuencial cumple el presupuesto; verificar con los números anotados frente a `performance-budget`
- [ ] 8.3 ADR `docs/adr/0009-pistas-de-subtitulo.md` (decisiones 1 a 4 del diseño), lista manual `docs/validation/windows-pistas.md` y actualización de README/CLAUDE.md si mencionan el par único; verificar que los archivos existen y enlazan entre sí
- [ ] 8.4 Guardar la decisión en Engram (`mem_save`), correr `openspec validate idiomas-y-subtitulos-multiples --strict` y dejar la change lista para archivar tras `ui-inicio-y-primer-uso`; verificar que la validación pasa
