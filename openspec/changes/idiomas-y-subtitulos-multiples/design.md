# Design

## Context

Motivación y alcance: ver `proposal.md`; requisitos: `specs/`.

Estado actual relevante:

- **Un solo destino de punta a punta.** `Settings.to: string` → `Engine::start_region(region, from, to)` / `start_audio(from, to, source)` → un `Arc<dyn Translator>` (un `OpusMt` cargado para ese par) → `Event::Translation { original, translated: String }` y `Event::Subtitle { original, translated: Option<String>, is_final }` → binding napi → `OverlayText { original, translated, final }` → `viewFor()` que pinta dos párrafos fijos (`#original`, `#translated`).
- **El trait ya es por par**: `Translator::translate(text, from, to)`; cada instancia de `OpusMt` se carga para un par concreto. La caché (`TranslationCache`) ya incluye `(texto, from, to)` en la clave, así que varios destinos comparten una caché sin colisiones.
- **Modelos por par** en el manifiesto (`mt-opus-en-es`, …): en→{es,fr,de,it}, es→{en,fr}, fr→{en,es}, de→en, it→en. OCR y STT dependen solo del origen.
- **La interfaz de Ajustes** elige pares cerrados (lista de pares en `languages-panel.tsx`, menú rápido `PairMenu` en `quick-setup.tsx`, `languageError(catalog, from, to)` en `form.ts`).
- **El overlay ya tiene una «pista original»**: `overlay.showOriginal`. Con una traducción disponible dibuja el original en pequeño; sin traducción muestra el original como línea principal.
- **Cambios pendientes de otra change**: `ui-inicio-y-primer-uso` (18/19) modifica el requisito «Idiomas» de `settings-window` y crea `home-start-screen`/`first-run-guide`, que hablan de «par activo». Esta change se escribió sobre ese texto y debe archivarse **después** de ella.

## Goals / Non-Goals

**Goals:**
- Origen y destinos como datos independientes en ajustes, motor, binding y UI.
- 0 a 3 destinos por sesión; con 0 destinos, cero modelos de traducción.
- Un evento por frase con todas las traducciones, para que el overlay nunca muestre pistas desfasadas entre sí.
- Que agregar un idioma o un motor siga sin tocar `tr-core` más allá de los tipos de evento (regla 3).
- Migración transparente de ajustes guardados.

**Non-Goals:**
- Traducción pivote (es→de vía inglés): no hay modelos de pares nuevos ni cadena de dos traducciones.
- Paralelizar las traducciones entre sí en esta versión (ver Decisión 4).
- Elegir otro orden de pistas que el fijo (original primero, destinos en orden de elección).
- Coloreado gramatical (otra change).

## Decisions

### 1. Ajustes: `targets: string[]` + `overlay.showOriginal` como pista original

`Settings.to` se sustituye por `targets` (0–3 códigos distintos, ≠ `from`). La pista original sigue siendo `overlay.showOriginal` (no se duplica la fuente de verdad) y su control visual pasa de Apariencia a la pestaña Idiomas. Invariante validada en `parseSettings`/`applyPatch`: `showOriginal || targets.length > 0`; al romperse se rechaza el parche (`applyPatch`) o, al leer del disco, se restaura `showOriginal = true` con aviso.

`SETTINGS_VERSION` se queda en 1: la lectura acepta el campo antiguo `to` (texto válido) cuando falta `targets` y lo convierte en `[to]`. Los ajustes importados (`settings-transfer.ts`) pasan por la misma lectura. `applyPatch` ya sustituye los valores no-objeto enteros, así que un parche `targets: [...]` reemplaza la lista.

*Alternativas descartadas*: (a) conservar `to` y añadir `extraTargets`: dos campos con semántica asimétrica y no permite «solo original»; (b) una lista `tracks: [{kind:'original'|'translation', lang}]`: más flexible (orden libre) pero el orden libre está fuera de alcance y complica la validación y la UI sin que nadie lo pida; (c) subir `SETTINGS_VERSION` a 2: hoy una versión desconocida restablece **todos** los ajustes a los valores por defecto, que es peor que migrar un campo.

### 2. Evento del núcleo con lista de traducciones

`tr-core::types`: nuevo `Translated { lang: Lang, text: String }`; `Event::Translation { original, translations: Vec<Translated>, timestamp }` y `Event::Subtitle { original, translations: Vec<Translated>, is_final, timestamp }` (parcial → vector vacío, como el `None` actual). Un solo evento por frase, emitido cuando están hechas todas las traducciones de esa frase.

*Alternativas descartadas*: un evento por destino (el overlay vería pistas que llegan en momentos distintos y habría que correlacionarlas); conservar `translated` y añadir `extra` (dos caminos de código para lo mismo).

### 3. Procesadores con una lista de traductores

`RegionConfig` y `AudioConfig` pasan de `to: Lang` a `targets: Vec<Lang>`; `RegionProcessor`/`AudioProcessor` reciben `Vec<Arc<dyn Translator>>` en el mismo orden que `targets` (un `Arc` por destino, el trait no cambia). Por frase: para cada destino, caché → traductor → caché; el orden de la lista es el orden de las líneas.

Fallos parciales (specs: «Orden y fallos parciales»): cada fallo emite su `Event::Error` (categoría `translation`) y su destino se omite de `translations`. El reintento actual (reiniciar estabilizador y detector) se conserva **solo si ningún destino tuvo éxito**; si al menos uno lo tuvo se emite el evento parcial y el destino fallido no se reintenta hasta que cambie el texto (evita un bucle de errores a cada frame y mantiene el overlay vivo). Sin destinos no se llama a ningún traductor y el evento sale con `translations` vacío.

### 4. Traducción secuencial en el hilo del pipeline

Los N destinos se traducen uno tras otro. La carga de modelos sí es paralela (ya lo es entre OCR y traductor en `real.rs`; se extiende a un hilo por destino con `std::thread::scope`). Razones para no paralelizar la inferencia ahora: cada `OpusMt` ya usa varios hilos de ONNX Runtime (`intra_threads`), así que paralelizar entre destinos compite por los mismos núcleos y el beneficio es incierto; la versión secuencial es determinista y trivial de probar con los fakes. Se mide en `docs/perf` (tarea de rendimiento): si 3 destinos exceden el presupuesto de latencia, se evalúa el paralelismo como cambio aparte.

### 5. Modelos requeridos por conjunto de destinos

`tr-models::Manifest`: `required_for`, `required_for_audio` y `required_for_all` pasan a recibir `&[Lang]` (los modelos de reconocimiento del origen más uno de traducción por destino, sin repetidos; con lista vacía solo reconocimiento). `tr-engine::models` (estado, descarga) y `real::{region_parts, audio_parts, ensure_fallback_ready}` usan las versiones nuevas; el error de modelos faltantes agrega los de todos los destinos sin duplicados. Una descarga con varios destinos baja solo lo que falta.

### 6. Engine y fallback

`Engine::start_region(region, from, targets: Vec<Lang>)` y `start_audio(from, targets, source)`. En el fallback, el `Vec<Arc<dyn Translator>>` de texto se comparte con el procesador de audio (misma regla que hoy, ahora por destino). Los motores de demostración devuelven un `FakeTranslator` por destino (su salida ya depende del idioma de destino, de modo que las pistas se distinguen en pruebas y demos).

### 7. Binding: listas en vez de textos

`startRegionTranslation(rect, from, to: string[])`, `startAudioSubtitles(from, to: string[], source?)`, `modelStatus(from, to: string[], scope?)`, `downloadModels(from, to: string[], scope?)`. El helper `languages()` valida en Rust (≤3, sin repetidos, ≠ origen, formato) y devuelve `InvalidArg`. Eventos: `TranslationEvent { original, translations: {lang, text}[], timestampMs }` y `SubtitleEvent { original, translations: {lang, text}[], isFinal, timestampMs }`. Es un cambio incompatible de la API de JS, aceptable porque el único consumidor es la propia app, que se actualiza en la misma change. El protocolo main↔worker (`protocol.ts`) cambia en las mismas órdenes.

### 8. Interfaz: origen, destinos y pistas en la pestaña Idiomas

- **Origen**: selector con los idiomas que el modo actual puede leer (texto → `ocrLanguages`; audio → `sttLanguages`; automático → intersección), con nombre en español (`languageName`).
- **Destinos**: lista de las pistas de traducción (máx. 3) con un selector «Añadir idioma» que ofrece `catalog.pairs.filter(p => p.from === origen)` menos los ya elegidos; cada fila muestra estado de modelos (`modelStatus(from, [lang])`), botón de descargar y quitar. Pista original: casilla «Mostrar el texto original».
- **Reglas de coherencia** en una función pura (`form.ts`, con pruebas): cambiar el origen filtra destinos y devuelve la lista de los quitados para avisar; imposibilidad de quedar sin pistas; límite de tres. Se guarda con un único parche atómico `{from, targets, overlay:{showOriginal}}` para no pasar por estados inválidos.
- **Inicio** (`ui-inicio-y-primer-uso`): el menú rápido sigue ofreciendo pares instalados; elegir uno fija `from` y `targets = [to]` (conserva `showOriginal`). El resumen del par muestra «inglés → español + francés» cuando hay varios destinos. La guía de primer uso valora «modelos instalados» sobre origen y todos los destinos.
- **Reinicio**: la clave de sesión del controlador (`sessionKey`) incluye origen y destinos; `showOriginal` no la afecta (se aplica en vivo por el estilo del overlay).

### 9. Overlay: pistas dinámicas

`OverlayText` pasa a `{ original, translations: {lang, text}[], final }`. `viewFor(text, style)` devuelve `lines: { lang, text, kind: 'original' | 'translation' }[]` (original primero si `showOriginal`; luego las traducciones); si no hay ninguna traducción y no hay original activo, muestra el original igualmente como línea provisional (parciales). El HTML sustituye `#original`/`#translated` por un contenedor `#tracks`; el renderer crea un `<p lang="…">` por línea con `createElement` y `textContent` (nunca HTML) más una etiqueta corta del idioma (`<span class="lang-tag" aria-hidden>`) cuando hay más de una línea. `--max-lines` se aplica por pista (`-webkit-line-clamp` en cada `<p>`) y `overlayHeight(fontSize, maxLines, tracks)` crece con el número de pistas; el controlador recalcula el tamaño de la ventana cuando cambian las pistas. La vista previa de Apariencia usa las mismas funciones con textos de muestra por idioma.

### 10. Pruebas y documentación

Núcleo: pruebas deterministas con `FakeTranslator` por destino (orden, 0 destinos, fallo parcial, caché por destino). Binding: pruebas de validación de `to[]` y de forma del evento. App: `settings` (migración, invariantes), `form` (coherencia de pistas), `view` (líneas), controlador (reinicio). Real: `real_pairs`/`real_engine` con dos destinos reales (`en→es`, `en→fr`) y medición en `docs/perf`. ADR 0009 documenta las decisiones 1–4; lista manual `docs/validation/windows-pistas.md`.

## Risks / Trade-offs

- **Latencia y RAM crecen con cada destino** (~100 MB y una inferencia más por frase) → límite de 3, traducción secuencial medida en `docs/perf`, caché compartida, y los destinos extra solo se cargan si se eligen.
- **Un destino que falla siempre** (p. ej. modelo corrupto) emite un error por frase → el error se informa por el canal de errores existente; el overlay sigue mostrando las demás pistas; la validación previa de modelos evita el caso normal.
- **Cambio incompatible del binding** → solo lo consume la app; el compilador de TypeScript y las pruebas de `tr-bindings` detectan cualquier uso olvidado.
- **Dependencia de orden entre changes**: `settings-window`/`home-start-screen` los define `ui-inicio-y-primer-uso` → archivarla antes; si no se archivara, el delta de «Idiomas» no aplicaría.
- **Overlay más alto** con 4 líneas puede tapar contenido → la colocación automática ya lo mantiene fuera de la región; `overlayHeight` se ajusta al número real de pistas y el límite de líneas por pista se mantiene configurable.
- **Origen sin destinos instalados** (solo original) es un modo nuevo para la guía de primer uso → el paso «descargar un idioma» se considera cumplido con los modelos de reconocimiento del origen cuando no hay destinos.

## Migration Plan

1. Rust: tipos y procesadores con tests (las pruebas antiguas se actualizan: un destino equivale a una lista de uno).
2. Engine, manifiesto y binding; regenerar `index.d.ts`.
3. App: ajustes con migración → protocolo/controlador → UI → overlay.
4. Verificación completa (`cargo fmt/clippy/test`, `pnpm test`, smokes) y medición.

Reversión: la change es un conjunto de commits sobre `main`; revertirlos devuelve el formato de ajustes anterior. Los ajustes que ya se hubieran escrito con `targets` se leerían como inválidos y volverían a valores por defecto (solo el campo `to`), sin pérdida del resto.
