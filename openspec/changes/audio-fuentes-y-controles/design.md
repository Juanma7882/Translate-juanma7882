# Design

## Context

Ver `proposal.md` (Why). Estado actual observado:

- `tr-core::ports::AudioCapture` tiene `start(on_chunk)` y `stop()`; no conoce fuentes. Las implementaciones son `PulseLoopback` (Linux, monitor del dispositivo de salida) y `CpalLoopback` (Windows/macOS, loopback del dispositivo de salida por defecto). La elección está en `tr-engine/src/real.rs` (`audio()`).
- La canalización de audio (`tr-core/src/audio.rs`) recibe trozos de 100 ms, mide `rms` y compara con `vad_threshold = 0.01`; lo que queda por debajo es silencio y nunca llega al STT. No emite nada hacia fuera sobre el nivel.
- `Event` (`tr-core/src/types.rs`) tiene Translation, Subtitle, ModeChanged, ModelProgress y Error. Los eventos viajan por `tr-bindings` (napi, `ThreadsafeFunction`) hasta el utility process y de ahí al proceso principal (`EngineHost`), que los reenvía a las ventanas.
- Pausar en solo audio no existe en el motor: `AppController.pause()` envía `stop` y `resume()` vuelve a enviar `startAudio`.
- La única UI de control es la bandeja; la ventana visible al arrancar es la de Ajustes (pestañas Idiomas, General, Modelos…).
- Medido en Windows con el `.node` real: el loopback entrega trozos, pero con el volumen actual el pico llegó a 0,0125 (el archivo original, a 0,91), por debajo del umbral, y no salió ningún subtítulo ni error.

## Goals / Non-Goals

**Goals:**
- Nivel de audio visible y diagnóstico del "audio muy bajo" y "sin señal".
- Captura de una aplicación concreta, con Windows como plataforma de validación primaria; Linux y macOS con el mismo contrato.
- Controles Iniciar / Pausar / Reiniciar / Detener con estado, en la ventana principal.

**Non-Goals:**
- Cambiar o adaptar el umbral del VAD (cambio aparte; este cambio solo lo hace visible).
- Capturar el micrófono, mezclar varias aplicaciones o excluir aplicaciones.
- Grabar, reproducir o transcribir el audio de la escucha previa: solo mide su nivel.

## Decisions

1. **La fuente es un valor del puerto, no un puerto nuevo.** `AudioCapture::start` pasa a recibir un `AudioSource` (`System` o `Process { id, name }`), y se añade un trait pequeño `AudioSourceLister` (`list() -> Result<Vec<AppAudio>, Unsupported>`). `core` solo conoce los tipos y traits (regla 3); cada plataforma implementa los dos en `tr-adapters`.
   *Alternativa:* un puerto por fuente → duplica la composición en `tr-engine` sin ganar nada.

2. **Windows: WASAPI process loopback** (`ActivateAudioInterfaceAsync` con `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, Windows 10 2004 o posterior, incluye el árbol de procesos). `cpal` solo hace loopback del dispositivo, así que se necesita la caja `windows` (Microsoft) con las características mínimas; antes de añadirla se verifican versión y mantenimiento (regla 5). Se mantiene `CpalLoopback` para "Todo el sistema". La enumeración usa las sesiones de audio activas del dispositivo de salida (`IAudioSessionManager2`), agrupando por nombre de programa, porque en navegadores y Discord el audio sale de procesos hijos.
   *Alternativas:* mezclador virtual (VB-Cable) → exige instalar controladores; captura por ventana → no existe API fiable.

3. **Linux:** enumeración por los *sink-inputs* de PulseAudio/PipeWire y captura con un flujo de grabación ligado a ese *sink-input* (`direct_on_input`), con la caja `pulseaudio` ya presente. Si el protocolo de la caja no expone lo necesario, la plataforma declara "no disponible" y se deja anotado (validación en WSLg).
   **macOS:** tap por proceso de CoreAudio (macOS 14.4 o posterior) y permiso de captura de audio; si `cpal` no lo expone, queda como "no disponible" en este cambio y se valida en el equipo real. Es un riesgo conocido, no un bloqueo.

4. **El nivel lo calcula la canalización de `tr-core`**, no la UI ni el adaptador: junto a la comparación con el VAD ya se tiene `rms` de cada trozo. Se añade `Event::AudioLevel { rms, peak }` (números) emitido por el `EventSink` existente, un evento por trozo de 100 ms. El umbral de voz viaja una vez al empezar (en la respuesta del arranque / estado) para que la UI dibuje su marca sin duplicar la constante.
   *Alternativa:* calcular en el adaptador → repetido por plataforma y sin acceso al umbral.

5. **Agrupar el nivel en el proceso principal**: `EngineHost` reenvía como mucho 15 eventos por segundo y solo el último valor (descarta los antiguos), para no saturar el IPC ni la ventana. En el renderer, la barra sube al instante y baja con suavizado (CSS/`requestAnimationFrame`); no hay estado persistente.

6. **Ventana principal = pestaña "Inicio" de la ventana existente** (primera pestaña, la que se abre al arrancar), con: estado, botones, selector de fuente, barra de nivel y avisos. Idiomas y el resto siguen en sus pestañas. Se reutilizan los canales y el preload de Ajustes (el guardián ya limita los mensajes a esa ventana). No se crea una ventana nueva.
   *Alternativa:* ventana nueva con otro preload → duplica IPC y guardia sin beneficio hoy.

7. **Reiniciar y Pausar viven en `AppController`** como operaciones serializadas (una cola de órdenes de una en una): `restart = stop + start` con los ajustes actuales; pulsar varias veces coalesce en una sola. Pausar en solo audio sigue siendo detener la captura y volver a abrirla; el nivel vuelve a cero.

8. **La fuente se guarda en los ajustes** (`audioSource: { kind: 'system' } | { kind: 'app', program: string }`) por nombre de programa, no por PID. Al iniciar, el controlador resuelve el programa contra la lista actual; si no suena, la sesión espera ("en espera de <programa>") y reintenta al aparecer. El esquema de ajustes se amplía con valor por defecto `system`; importar/exportar lo incluye (no es dato sensible).

9. **Sin modelos:** `Iniciar` usa el flujo existente de `models-missing` (aviso + pestaña Idiomas); el botón nunca queda deshabilitado sin explicación.

10. **Escucha previa del nivel** (añadida después, a petición del usuario: la barra debe moverse en cuanto hay una fuente elegida, sin pulsar Iniciar).
    - *Motor:* `tr-core::monitor::LevelMonitor` abre la captura con `start_source`, mide cada trozo de 100 ms (`rms` y `peak`) y emite solo `Event::AudioLevel`; no pasa por VAD, STT ni traducción, no necesita modelos y descarta el audio al medirlo. Reutiliza el puerto `AudioCapture`, así que no cambia `core` ni los adaptadores. La captura entrega a una cola acotada y un hilo propio mide y emite, igual que `AudioRunner` (la captura nunca bloquea). Un fallo al abrir la fuente se **devuelve** y no se emite como `Event::Error`, para que no parezca un error de la sesión.
    - *Convivencia con las sesiones:* `Engine` guarda a lo sumo una escucha. `start_region` y `start_audio` la detienen justo antes de reemplazar la sesión (después de validar modelos, así que un arranque fallido por modelos no la apaga), y `start_audio_monitor` devuelve `false` si hay una sesión (no hay carrera por el dispositivo). `stop()` no la toca; `configure` la traspasa al motor nuevo para que cambiar de ajustes no la mate en silencio.
    - *Puente:* `startAudioMonitor(source?) -> boolean` y `stopAudioMonitor()`. `api.js` deja pasar `onAudioLevel` también mientras escucha (hoy solo lo hace con la sesión en marcha y sin pausa).
    - *Quién decide cuándo:* el proceso principal (`AudioMonitor`), no el renderer. La interfaz solo declara «Inicio está a la vista» (`audio:watch`); main aplica las reglas: sin sesión (`controller.state.running` falso), modo distinto de «Solo texto», ventana existente. Resuelve el programa elegido contra la lista de aplicaciones como el controlador (espera con reintento cada 2 s si no suena), reconfigura el motor con los ajustes actuales antes de abrir (así usa motores reales o de demostración según el ajuste) y reacciona a cambios de fuente, motores, modo, caída y reinicio del motor. Un fallo de captura no se reintenta en bucle: se muestra el motivo y se reintenta al cambiar fuente, modo o pestaña.
    - *Privacidad:* mientras Inicio está a la vista la app escucha la fuente aunque no se haya iniciado nada; por eso la barra dice «Escuchando…» y que no se guarda ni se traduce nada hasta pulsar Iniciar. No se activa con la ventana oculta, minimizada o cerrada, ni en «Solo texto».
    - *Alternativa descartada:* arrancar la escucha desde el renderer con las órdenes de sesión → la UI decidiría el ciclo de vida de un dispositivo de audio y una ventana cerrada lo dejaría abierto.

## Risks / Trade-offs

- [Captura por proceso exige Windows 10 2004+] → detectar versión/`E_NOTIMPL` y caer a "Todo el sistema" con un mensaje.
- [Aplicaciones con audio en varios procesos (Chrome, Discord)] → agrupar por programa y capturar el árbol (`INCLUDE_TARGET_PROCESS_TREE`); validar con Firefox, Chrome y Discord en Windows.
- [Nivel de eventos a 10 Hz × ventanas] → agrupación en main y descarte de antiguos.
- [macOS/Linux sin soporte de la caja] → contrato "no disponible" explícito, validación manual documentada en `docs/validation/`.
- [`unsafe`] → `tr-adapters` tiene `forbid(unsafe_code)`: la captura por proceso de Windows exige llamadas COM; el código con `unsafe` irá en un módulo aislado y revisado, o la caja `windows` lo cubre sin `unsafe` propio; se decide al verificar la caja y se registra en un ADR.
- [Pausa en solo audio reabre el dispositivo] → aceptado; ya es el comportamiento actual.
- [La escucha previa captura sin que el usuario haya iniciado nada] → solo con Inicio a la vista, con rótulo visible, nunca en «Solo texto» y sin guardar nada; la validación manual comprueba que al cambiar de pestaña, minimizar o cerrar no queda ninguna captura abierta.
- [WASAPI loopback no entrega trozos si no suena nada] → la barra se queda en cero (el almacén de niveles ya trata un nivel viejo como cero); es el comportamiento esperado de «no suena nada».
- [Dos capturas abiertas a la vez sobre el mismo dispositivo] → el motor garantiza que la escucha se detiene antes de abrir la de la sesión y que no arranca con una sesión en marcha.
- [macOS pedirá el permiso de captura de audio al abrir Inicio, no al pulsar Iniciar] → anotado en la validación manual de macOS.

## Migration Plan

Ajustes antiguos sin `audioSource` se leen como `system`. Sin cambios para quien no use la función. Reversible quitando la pestaña y el campo; el motor ignora la fuente `system` igual que hoy.

## Open Questions

- Texto y estilo exactos de la barra y avisos (se afinan al implementar, con revisión de contraste ya existente en la app).
- Si más adelante conviene un ajuste para desactivar la escucha previa (hoy siempre está activa con Inicio a la vista); no cambia el contrato de la escucha.
