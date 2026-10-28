# Tasks

## 1. Núcleo y motor

- [x] 1.1 Tests de histéresis con reloj inyectado en `tr-core::fallback`: texto intermitente durante 60 s sin cambios de modo, umbrales configurables y conteo de transiciones acotado
- [x] 1.2 `real::audio_parts` acepta un traductor compartido; el fallback real lo reutiliza; actualizar los tests de `real.rs`
- [x] 1.3 Comprobación agregada de modelos (`required_for_all`) en `Engine::start_region` con fallback real, con tests (unión sin duplicados)
- [x] 1.4 Test real ignorado `real_fallback`: ventana con texto -> traducción; quitar el texto y reproducir una frase -> modo audio y subtítulo; volver el texto -> modo texto
- [x] 1.5 Documentar en `tr-bindings` el evento de modo (solo fallback)

## 2. Ajustes y lógica de app

- [x] 2.1 `Settings.mode`, `fallbackSeconds` y `shortcuts.toggleMode` con validación y tests; `engineOptionsFrom` según el modo
- [x] 2.2 `AppState.mode`; controlador: arranque por modo, `setMode`/`cycleMode` con reinicio en caliente, región opcional en audio, modo activo desde el evento `mode`; tests con host falso
- [x] 2.3 Bandeja: submenú "Modo" y tooltip; `ShortcutManager` con `toggleMode`; tests
- [x] 2.4 Primer uso por ámbito: `scopeForMode` y reintento solo con los modelos del ámbito listos

## 3. Overlay y ventana de Ajustes

- [x] 3.1 Overlay: canal `overlay:mode`, etiqueta de modo, limpieza al cambiar; tests de la lógica pura
- [x] 3.2 Ajustes: modo, segundos del fallback, atajo de modo y aviso de modelos; mensajes de validación

## 4. Smokes y validación

- [x] 4.1 Extender smoke `shell`: modo alternado por bandeja y atajo con motores de demostración, indicador en el overlay y primer uso de audio
- [x] 4.2 Extender smoke `settings`: modo, segundos y atajo
- [x] 4.3 Escribir `docs/adr/0005-fallback.md` y `docs/validation/windows-hito-4.md`
- [x] 4.4 Verificar fmt, clippy, tests de Rust (incluidos los ignorados en serie), tests de Node del binding, `npm run typecheck && npm test && npm run build` y los smokes
- [x] 4.5 Guardar decisiones en Engram y editar `CLAUDE.md` mínimamente
