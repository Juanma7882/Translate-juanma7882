# Proposal

## Why

Hoy la app traduce de **un** idioma a **otro** y lo ofrece como pares cerrados («inglés → español»): no se puede elegir el idioma del contenido y el de la traducción por separado, ni ver más de una versión del texto a la vez. Para quien mira contenido en inglés y quiere leer a la vez el original y el español (o español y francés, para comparar o aprender) hay que cambiar el par cada vez. Además, el subtitulado sin traducir («solo inglés») no existe como opción, aunque el OCR y el reconocimiento de voz ya lo hacen sin ningún modelo de traducción.

## What Changes

- **Idiomas separados en la interfaz**: dos selectores independientes, «El contenido está en…» (origen) y «Traducir a…» (destino). El destino solo ofrece los idiomas que tienen modelo para el origen elegido. Si al cambiar el origen un destino deja de ser válido, se avisa y se quita; nada cambia en silencio.
- **Varias pistas de subtítulo a la vez**: el usuario elige qué líneas ve el overlay: la **original** (el texto leído por OCR o transcrito del audio) y **hasta 3 traducciones**. Ejemplos: solo inglés; inglés y español; español y francés. Las pistas se muestran en un orden fijo (original primero, luego los destinos en el orden elegido).
- **Subtitulado sin traducir**: con solo la pista original no se carga ningún modelo de traducción (basta el OCR o el STT del idioma de origen).
- **Motor con N traductores**: se carga un traductor por destino elegido; los eventos de traducción y de subtítulo llevan una **lista `[(idioma, texto)]`** en lugar de un único `translated`. Si un destino falla, los demás se muestran y el fallo se informa.
- **Ajustes**: `to` pasa a ser una lista `targets` (0 a 3 idiomas distintos del origen); los ajustes guardados con el formato anterior (`to` como texto) se migran solos. La opción «Mostrar original» (`overlay.showOriginal`) es la pista original y se mueve a la pestaña de Idiomas. Debe haber al menos una pista activa.
- **BREAKING (API de JS interna)**: `startRegionTranslation(rect, from, to)` y `startAudioSubtitles(from, to, source)` reciben `to: string[]`; `modelStatus`/`downloadModels` también; `TranslationEvent` y `SubtitleEvent` sustituyen `translated` por `translations: {lang, text}[]`. El único consumidor es la propia app.

No cambia (fuera de alcance): el coloreado gramatical de las oraciones (otra change posterior); traducir pasando por un idioma pivote (p. ej. es→de vía inglés); nuevos pares o modelos; el formato del overlay más allá de mostrar varias líneas.

## Capabilities

### New Capabilities
- `subtitle-tracks`: qué pistas de subtítulo se muestran (original y 0 a 3 traducciones), su validación (al menos una; destinos distintos del origen y con modelo), su persistencia y su comportamiento ante fallos parciales.

### Modified Capabilities
- `settings-window`: el requisito «Idiomas» pasa a dos selectores independientes con destinos filtrados por origen, y se añade la elección de pistas.
- `region-pipeline`: «Traducción de una región» emite el original y las traducciones de todos los destinos (ninguna si no hay destinos).
- `audio-pipeline`: «Subtítulos desde audio» y «Traducción de segmentos finales» igual, con la lista de traducciones.
- `engine-composition`: «Fallback real con un solo traductor» pasa a un traductor por destino, compartido entre texto y audio; sin destinos no se carga ninguno.
- `js-bridge`: «Comandos», «Eventos» y «Estado y descarga de modelos» aceptan una lista de destinos y entregan la lista de traducciones.
- `translation-overlay`: «Original y traducción visibles» pasa a mostrar todas las pistas elegidas.

## Impact

- **Rust**: `tr-core` (`types.rs`: `Event::Translation`/`Subtitle`; `region.rs`, `audio.rs`: procesadores con lista de traductores), `tr-engine` (`engine.rs`, `real.rs`, `fake.rs`, `models.rs`: un traductor por destino, modelos requeridos por destinos), `tr-models` (`manifest.rs`: modelos requeridos para un conjunto de destinos), `tr-bindings` (`lib.rs`, `events.rs`, `index.d.ts`, `api.js`). Tests de `tr-core`, `tr-engine` y bindings se actualizan.
- **Electron/TS**: `shared/settings.ts` (+ migración), `shared/ipc.ts` (`OverlayText`), `shared/protocol.ts`, `main/app-controller.ts`, `main/engine-host.ts`, `main/settings-ipc.ts`, `main/tray-menu.ts`, `renderer/settings/*` (`languages-panel.tsx`, `quick-setup.tsx`, `home-panel.tsx`, `start-guide.tsx`, `form.ts`), `renderer/overlay/view.ts` y `main.ts`, `settings-transfer.ts` (importar ajustes antiguos).
- **Coste de recursos**: cada destino extra carga otro modelo (~100 MB de RAM) y suma latencia; por eso el límite de 3 y la medición en `docs/perf`.
- **Reglas**: todo en RAM (las listas viajan en memoria, nada a disco), local por defecto, patrón adapter (el núcleo sigue conociendo solo el trait `Translator`; agregar un destino no toca `core`), la UI nunca se bloquea, ninguna dependencia nueva.
- **Documentación**: ADR 0009 con la decisión de pistas y destinos; lista de validación manual para Windows/macOS.
