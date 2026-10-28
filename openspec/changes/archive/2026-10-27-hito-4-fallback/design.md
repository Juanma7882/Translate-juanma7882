# Design

## Context

El núcleo (`tr-core::fallback`) ya implementa la máquina de estados pura `step` (3 s sin texto -> audio, 1 s con texto -> texto, pausa/reanudación) y `Engine::start_region` ya arma `TextOrAudioPipeline` con `EngineKind::Real` cuando `fallback` está configurado. `tr-bindings` ya expone `autoFallback`, `fallbackNoTextMs`, `fallbackTextMs`, `onModeChanged` y `scope` en los modelos. Lo que falta está en la app y en dos detalles de composición. Decisiones en `docs/adr/0005-fallback.md`.

## Goals / Non-Goals

**Goals:** modo seleccionable y alternable en caliente, indicador, ajustes mínimos, primer uso con modelos de audio, pruebas con reloj inyectado y reales.
**Non-Goals:** selección de dispositivo de audio, rediseño de Ajustes, ajuste del umbral de regreso a texto (`text_for` fijo en 1 s), caché de traducción de audio (Hito 5).

## Decisions

- **Modo como ajuste, no como estado del motor.** `Settings.mode: auto | text | audio`. La app elige la orden: auto = `startRegion` con `autoFallback: true`; texto = `startRegion` sin fallback; audio = `startAudio` (sin región). Cambiar de modo en caliente es `configure` + nueva orden (el motor reemplaza la sesión), sin tocar el núcleo.
- **Modo activo en `AppState.mode` (`text | audio | null`).** En auto lo marca el evento `mode` del núcleo; en los modos forzados lo fija el controlador (el motor no emite evento ahí y emitirlo cambiaría el contrato de los pipelines simples). La pausa no borra el modo activo.
- **Alternar = ciclar.** El atajo `toggleMode` rota auto -> texto -> audio -> auto. La bandeja ofrece la elección directa. Si el nuevo modo necesita región y no hay, se abre el selector.
- **Fallback configurable por un solo número** (`fallbackSeconds`, 1-60, 3 por defecto -> `fallbackNoTextMs`); el regreso a texto queda en 1 s. La histéresis ya vive en `step`; se añaden tests con reloj inyectado de secuencias largas.
- **Traductor compartido.** `real::audio_parts` recibe `Option<Arc<dyn Translator>>`; el fallback pasa el de la región (el trait es `Send + Sync`). Evita cargar dos veces ~110 MB.
- **Modelos faltantes agregados.** Con fallback real, `Engine::start_region` comprueba `required_for_all` antes de construir nada y lista la unión; así el usuario ve todo lo que falta en un aviso.
- **Primer uso por ámbito.** `scopeForMode`: texto -> `text`, audio -> `audio`, auto -> `all`. El aviso `models-missing` abre Ajustes; tras cada descarga se consulta el estado del ámbito y solo si todo está listo se retoma el arranque.
- **Indicador en el overlay.** Canal `overlay:mode` (solo el nombre del modo). Etiqueta dentro de `#box`; al cambiar de modo se limpia el texto y se muestra la caja unos segundos con solo la etiqueta.
- **Atajos.** `shortcuts.toggleMode` (por defecto `CommandOrControl+Shift+M`) pasa por el `ShortcutManager` existente, con aviso si falla.

## Risks / Trade-offs

- [OCR con falsos positivos mantiene el modo texto con pantalla vacía] -> umbral de 3 s y OCR real ya filtra confianza; ajustable.
- [Reiniciar la sesión al cambiar de modo pierde el estado interno (caché, estabilizador)] -> aceptable; el cambio es manual y poco frecuente.
- [Tres modelos grandes en RAM en auto (OCR + Whisper + traductor)] -> medido en el test real; el traductor compartido lo reduce.
- [Loopback de Windows/macOS no verificable en WSL] -> `docs/validation/windows-hito-4.md`.

## Open Questions

- Umbral óptimo de `no_text_for` con contenido real (subtítulos incrustados, menús) tras probar en Windows.
