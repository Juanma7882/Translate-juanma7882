# Proposal

## Why

Tras los Hitos 1-3 el motor sabe traducir texto en pantalla (OCR real) y subtitular audio (STT real), y el núcleo tiene la máquina de estados del fallback con fakes, pero la aplicación no lo usa: el usuario no puede elegir entre modo automático, solo texto o solo audio, no hay forma de alternar de modo en caliente, el overlay no indica qué modo está activo y el primer uso solo contempla los modelos de texto. El Hito 4 cierra ese hueco: "si en la región no hay texto durante N segundos, pasar a audio; al reaparecer el texto, volver", con motores reales y de punta a punta en la app.

## What Changes

- Ajustes: `mode` (`auto` por defecto, `text`, `audio`), `fallbackSeconds` (tiempo sin texto antes de pasar a audio) y atajo global `toggleMode` (cicla auto -> texto -> audio).
- App: el controlador arranca según el modo (auto = región con fallback; texto = región sin fallback; audio = subtítulos del sistema, sin región), reinicia al cambiar de modo en caliente y expone el modo activo en `AppState`.
- Bandeja: submenú "Modo" (radio) y tooltip con el modo activo; "Traducir" también habilitado en modo audio sin región.
- Overlay: indicador del modo activo (texto / audio / pausa) y limpieza del texto anterior al cambiar de modo.
- Ajustes (ventana): selector de modo, tiempo de espera del fallback, atajo de modo y aviso de qué modelos hacen falta.
- Primer uso: el modo auto necesita modelos de texto y de audio; el motor informa todos los que faltan de una vez y la app solo retoma lo pendiente cuando están listos los del ámbito del modo.
- `tr-engine`: en el fallback real el traductor se carga una vez y lo comparten texto y audio; el error de modelos ausentes lista la unión de ambos ámbitos.
- Pruebas: histéresis con reloj inyectado, test real (texto -> sin texto + frase -> subtítulo) bajo Xvfb y audio de WSLg, y smokes de Electron del modo alternado.
- ADR 0005 y `docs/validation/windows-hito-4.md`.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `text-audio-fallback`: modos seleccionables (auto/texto/audio), alternancia en caliente y sin parpadeo.
- `app-integration`: atajo y menú de modo, primer uso con modelos de audio.
- `translation-overlay`: indicador de modo.
- `settings-window`: modo, tiempo de espera del fallback y atajo.
- `engine-composition`: fallback real con un solo traductor y modelos faltantes agregados.
- `js-bridge`: el evento de modo se documenta como solo emitido por el fallback; la app deriva el modo en los modos forzados.

## Impact

- Crates: `tr-engine` (real.rs, engine.rs), `tr-core` (solo tests), `tr-bindings` (docs).
- App: `shared/settings.ts`, `shared/ipc.ts`, `main/app-controller.ts`, `app-shell.ts`, `tray-menu.ts`, `shortcuts.ts`, `engine-options.ts`, `overlay-controller.ts`, preload y renderer del overlay y de Ajustes, smokes.
- Sin dependencias nuevas. Sin cambios en CI ni empaquetado.
- Lo no verificable en WSL (loopback WASAPI/CoreAudio con el fallback, atajos globales reales) va a `docs/validation/windows-hito-4.md`.
