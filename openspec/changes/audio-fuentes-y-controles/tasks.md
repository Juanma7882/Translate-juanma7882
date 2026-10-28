# Tasks

## 1. tr-core: tipos y nivel

- [x] 1.1 `AudioSource` (`System` / `Process { id, name }`), `AppAudio` y trait `AudioSourceLister`; `AudioCapture::start` recibe la fuente; actualizar fakes de `tr_core::testing` y verificar que compila y pasan `cargo test -p tr-core`
- [x] 1.2 `Event::AudioLevel { rms, peak }` emitido por la canalización de audio por cada trozo de 100 ms (también bajo el umbral del VAD); test con trozos de nivel conocido y comprobación de que no cambia qué se descarta como silencio
- [x] 1.3 Exponer el umbral de voz (`vad_threshold`) para la interfaz y test de que no se duplica la constante en TS
- [x] 1.4 Verificar que `no_content_leaks` y los lints siguen en verde (el evento solo lleva números)

## 2. tr-adapters: fuentes por plataforma

- [x] 2.1 Verificar versión y mantenimiento de la caja `windows` (regla 5), decidir cómo cumplir `forbid(unsafe_code)` y registrarlo en `docs/adr/0008-audio-por-aplicacion.md`
- [ ] 2.2 Windows: enumeración de aplicaciones con audio activo agrupadas por programa; test de la agrupación con datos simulados y prueba manual con Firefox, Chrome y Discord
- [ ] 2.3 Windows: captura por proceso (process loopback, árbol de procesos) hacia el mismo `Chunker`; test de conversión de formato y de errores (versión no soportada, proceso inexistente) sin hilos huérfanos
- [x] 2.4 Windows: aviso de fuente perdida al cerrarse la aplicación; verificado con una aplicación de prueba que se cierra
- [ ] 2.5 Linux: enumerar *sink-inputs* y capturar uno con la caja `pulseaudio`; probar en WSLg, o declarar "no disponible" con motivo si el protocolo no lo permite
- [x] 2.6 macOS: tap por proceso si `cpal` lo expone; si no, "no disponible" con motivo; anotar en la lista de validación manual
- [ ] 2.7 `CpalLoopback` y `PulseLoopback` aceptan `AudioSource::System` sin cambio de comportamiento; los tests existentes de captura siguen pasando

## 3. tr-engine y bindings

- [x] 3.1 `Engine::start_audio(from, to, source)` y `Engine::list_audio_sources()`; test con captura falsa por fuente y por fuente inexistente
- [x] 3.2 napi: `startAudioSubtitles(from, to, source?)`, `listAudioSources()`, `onAudioLevel`; actualizar `api.js` e `index.d.ts`, y test de Node de fuente inválida y de niveles
- [ ] 3.3 Prueba real ignorada en Windows: una frase por el dispositivo de salida, nivel > 0 y subtítulo con la fuente "sistema"

## 4. App: main y compartido

- [x] 4.1 Protocolo del motor (`protocol.ts`, worker): órdenes `listAudioSources` y fuente en `startAudio`, evento de nivel; tests unitarios
- [x] 4.2 `EngineHost`: agrupar niveles a 15 Hz máximo conservando el último; test con reloj simulado
- [x] 4.3 Ajustes: campo `audioSource` (por defecto `system`), validación, migración de ajustes antiguos e incluirlo en importar/exportar; tests de `settings`
- [x] 4.4 `AppController`: cola de órdenes serializada, `restart()`, estado "iniciando", fuente resuelta por nombre de programa con espera y reintento; tests de pulsaciones repetidas y de aplicación cerrada
- [x] 4.5 IPC de la ventana principal: acciones iniciar, pausar, reanudar, reiniciar y detener, lista de fuentes y nivel, con guardia de remitente; test de IPC

## 5. App: interfaz

- [x] 5.1 Pestaña "Inicio" (primera y por defecto): estado, modo, fuente y botones con habilitación por estado y región `aria-live`; test de lógica de botones y smoke `settings`
- [ ] 5.2 Selector de fuente (Todo el sistema + aplicaciones, actualizado en vivo, aviso si la plataforma no lo permite); test de lógica y prueba manual
- [x] 5.3 Barra de nivel con marca del umbral, bajada suave, alternativa de texto y avisos "audio muy bajo" / "no llega audio"; tests de la lógica de avisos y contraste de estilos
- [ ] 5.4 Iniciar sin modelos: mensaje con tamaño y salto a la pestaña Idiomas; test de que el botón no queda inerte
- [ ] 5.5 Ajustar smokes que abren la ventana (`TR_SMOKE=settings|shell|e2e`) y comprobar que pasan

## 6. Cierre

- [x] 6.1 `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, tests de bindings y `cd app && npm run typecheck && npm test`
- [x] 6.2 Lista de validación manual en Windows (`docs/validation/windows-audio-fuentes.md`): sistema, Firefox, Chrome, Discord, un juego, aplicación cerrada, volumen bajo con la barra
- [ ] 6.3 Guardar en Engram las decisiones del cambio y archivar con `/opsx:archive` (después del grupo 7)

## 7. Escucha previa del medidor (añadido después; va antes de archivar)

- [x] 7.1 `tr-core`: `monitor::LevelMonitor` (captura -> nivel por trozo, sin VAD ni STT, sin retener audio); tests: nivel por trozo, silencio a cero, solo eventos de nivel, parada limpia sin eventos posteriores, fallo de arranque devuelto sin `Event::Error`, la fuente llega a la captura, una cola llena no bloquea la captura
- [x] 7.2 `tr-engine`: `Engine::start_audio_monitor(source) -> bool` y `stop_audio_monitor()`; `start_region` y `start_audio` la detienen antes de reemplazar la sesión; devuelve `false` con una sesión en marcha; `configure` la traspasa; tests con motores de demostración (niveles sin sesión, cede ante cada tipo de sesión, `stop()` no la toca, fuente inexistente, un arranque de sesión fallido por modelos no la apaga)
- [x] 7.3 `tr-bindings`: napi `startAudioMonitor(source?) -> boolean` y `stopAudioMonitor()`, `configure` conserva la escucha; `api.js` deja pasar `onAudioLevel` mientras escucha; regenerar `index.d.ts`/`api.d.ts`; tests de Node (niveles sin sesión y sin subtítulos, cede ante la sesión, ningún nivel tras `stopAudioMonitor`, fuente inválida, sobrevive a `configure`)
- [x] 7.4 Protocolo y reparto: órdenes `startAudioMonitor`/`stopAudioMonitor` en `protocol.ts` y `dispatch.ts`; tests unitarios
- [x] 7.5 `AudioMonitor` en main (`audio-monitor.ts`): escucha cuando Inicio está a la vista, no hay sesión y el modo no es «Solo texto»; cede ante la sesión y vuelve al terminar; sigue fuente, motores y modo; espera a la aplicación elegida; no reintenta en bucle un fallo; maneja caída y reinicio del motor y la ventana cerrada; tests con motor y reloj simulados
- [x] 7.6 IPC `audio:watch` y `audio:monitor-state` con guardia de remitente, `SettingsApi.watchAudioLevel/onMonitorState` y preload; `ModelsService.ensureConfigured` pública; test de IPC (remitente ajeno rechazado, ventana cerrada apaga la escucha)
- [x] 7.7 Interfaz: la barra se anima con la escucha o con la sesión y se pone a cero al dejar de medir; nota «Escuchando…» / «Esperando a…» / «No se pudo escuchar…» / «El modo Solo texto no usa el audio»; la lógica en funciones puras con tests
- [x] 7.8 Smoke `TR_SMOKE=settings` con motores de demostración: la barra se mueve sin sesión, se detiene al empezar una y vuelve al terminar; lista manual en Windows (`docs/validation/windows-escucha-previa.md`)
- [x] 7.9 `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, tests de bindings y `cd app && npm run typecheck && npm test` en verde
