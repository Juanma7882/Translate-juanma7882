# Proposal

## Why

Hoy la app traduce de **un** idioma a **otro** y lo ofrece como pares cerrados («inglés → español»): no se puede elegir el idioma del contenido y el de la traducción por separado, ni ver más de una versión del texto a la vez. Para quien mira contenido en inglés y quiere leer a la vez el original y el español (o español y francés, para comparar o aprender) hay que cambiar el par cada vez. Además, el subtitulado sin traducir («solo inglés») no existe como opción, aunque el OCR y el reconocimiento de voz ya lo hacen sin ningún modelo de traducción.

## What Changes

- **Idiomas separados en la interfaz**: dos selectores independientes, «El contenido está en…» (origen) y «Traducir a…» (destino). El destino solo ofrece los idiomas que tienen modelo para el origen elegido. Si al cambiar el origen un destino deja de ser válido, se avisa y se quita; nada cambia en silencio.
- **Uno o dos subtítulos a la vez**: el usuario elige si activa solo 1 o 2 subtítulos, cada uno en un idioma distinto. Un subtítulo es el **original** (el texto leído por OCR o transcrito del audio, que cuenta como uno) o una **traducción**. Ejemplos: solo inglés; inglés y español; español y francés. En la interfaz son «Subtítulo 1» (siempre activo) y «Subtítulo 2» (opcional). Se muestran en un orden fijo: el original arriba y la traducción debajo.
- **Subtitulado sin traducir**: con solo el subtítulo original no se carga ningún modelo de traducción (basta el OCR o el STT del idioma de origen).
- **Motor con N traductores en paralelo**: se carga un traductor por destino elegido (máximo 2) y, con dos destinos, se traducen **a la vez** para que el texto aparezca cuando termina la traducción más lenta y no la suma. Los eventos de traducción y de subtítulo llevan una **lista `[(idioma, texto)]`** en lugar de un único `translated`. Si un destino falla, el otro se muestra y el fallo se informa.
- **Ajustes**: `to` pasa a ser una lista `targets` (0 a 2 idiomas distintos del origen); los ajustes guardados con el formato anterior (`to` como texto) se migran solos. La opción «Mostrar original» (`overlay.showOriginal`) es el subtítulo original y se mueve a la pestaña de Idiomas. Debe haber entre 1 y 2 subtítulos activos (el original cuenta como uno).
- **BREAKING (API de JS interna)**: `startRegionTranslation(rect, from, to)` y `startAudioSubtitles(from, to, source)` reciben `to: string[]`; `modelStatus`/`downloadModels` también; `TranslationEvent` y `SubtitleEvent` sustituyen `translated` por `translations: {lang, text}[]`. El único consumidor es la propia app.

No cambia (fuera de alcance): el coloreado gramatical de las oraciones (otra change posterior); traducir pasando por un idioma pivote (p. ej. es→de vía inglés); nuevos pares o modelos; elegir el orden de los subtítulos (es fijo: original arriba); el formato del overlay más allá de mostrar dos líneas.

## Capabilities

### New Capabilities
- `subtitle-tracks`: qué subtítulos se muestran (1 o 2, en idiomas distintos, contando el original como uno), su validación (destinos distintos del origen y con modelo), su traducción simultánea, su persistencia y su comportamiento ante fallos parciales.

### Modified Capabilities
- `settings-window`: el requisito «Idiomas» pasa a dos selectores independientes con destinos filtrados por origen, y se añade la elección de los dos subtítulos.
- `region-pipeline`: «Traducción de una región» traduce a todos los destinos a la vez y emite el original y las traducciones (ninguna si no hay destinos).
- `audio-pipeline`: «Subtítulos desde audio» y «Traducción de segmentos finales» igual, con la lista de traducciones y la traducción simultánea.
- `engine-composition`: «Fallback real con un solo traductor» pasa a un traductor por destino (máximo 2), compartido entre texto y audio; sin destinos no se carga ninguno.
- `js-bridge`: «Comandos», «Eventos» y «Estado y descarga de modelos» aceptan una lista de destinos y entregan la lista de traducciones.
- `translation-overlay`: «Original y traducción visibles» pasa a mostrar los subtítulos elegidos (uno o dos líneas).

## Impact

- **Rust**: `tr-core` (`types.rs`: `Event::Translation`/`Subtitle`; `region.rs`, `audio.rs`: procesadores con lista de traductores), `tr-engine` (`engine.rs`, `real.rs`, `fake.rs`, `models.rs`: un traductor por destino, modelos requeridos por destinos), `tr-models` (`manifest.rs`: modelos requeridos para un conjunto de destinos), `tr-bindings` (`lib.rs`, `events.rs`, `index.d.ts`, `api.js`). Tests de `tr-core`, `tr-engine` y bindings se actualizan.
- **Electron/TS**: `shared/settings.ts` (+ migración), `shared/ipc.ts` (`OverlayText`), `shared/protocol.ts`, `main/app-controller.ts`, `main/engine-host.ts`, `main/settings-ipc.ts`, `main/tray-menu.ts`, `renderer/settings/*` (`languages-panel.tsx`, `quick-setup.tsx`, `home-panel.tsx`, `start-guide.tsx`, `form.ts`), `renderer/overlay/view.ts` y `main.ts`, `settings-transfer.ts` (importar ajustes antiguos).
- **Coste de recursos**: cada destino extra carga otro modelo (~100 MB de RAM, 200 MB con dos) y, al traducir en paralelo, compite por los núcleos con el otro; por eso el límite de 2 subtítulos y la medición en `docs/perf` de 1 y 2 destinos.
- **Reglas**: todo en RAM (las listas viajan en memoria, nada a disco), local por defecto, patrón adapter (el núcleo sigue conociendo solo el trait `Translator`; agregar un destino no toca `core`), la UI nunca se bloquea, ninguna dependencia nueva.
- **Documentación**: ADR 0009 con la decisión de pistas y destinos; lista de validación manual para Windows/macOS.
