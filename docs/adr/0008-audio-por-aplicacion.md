# ADR 0008 — Captura de audio por aplicación en Windows

- Estado: aceptado
- Fecha: 2026-10-28
- Contexto: cambio `openspec/changes/audio-fuentes-y-controles` (tareas 2.1 a 2.4). Complementa a `0004-audio-stt.md`.

## Decisión

| Pieza | Elección |
|---|---|
| Captura por aplicación | WASAPI *process loopback* (`ActivateAudioInterfaceAsync`, `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, `INCLUDE_TARGET_PROCESS_TREE`), Windows 10 2004 o posterior |
| Acceso a COM | caja `wasapi` =0.26.0 (MIT, HEnquist, MSRV 1.85), sobre `windows` 0.62.2 (la misma versión que ya arrastra `cpal`) |
| Enumeración | `IAudioSessionManager2` del dispositivo de salida por defecto, solo sesiones activas, vía la misma caja |
| Nombre y árbol de procesos | `sysinfo` =0.39.6 (MIT, MSRV 1.95), `default-features = false, features = ["system"]` |
| Todo el sistema | sin cambios: `CpalLoopback` |

Ambas dependencias van bajo `[target.'cfg(windows)'.dependencies]` y tras la feature `audio-loopback`, con versión exacta (regla 5). Versiones verificadas el 2026-10-28 en crates.io.

## `unsafe`

`tr-adapters` conserva `#![forbid(unsafe_code)]`. No se añadió la caja `windows` directamente ni ningún módulo con `unsafe`: `wasapi` expone una API segura de todo lo necesario (`AudioClient::new_application_loopback_client`, lectura de paquetes, `AudioSessionEnumerator`, `AudioSessionControl::get_process_id` / `get_state`), y contiene el `unsafe` de COM en su propio código, ya revisado y usado por terceros. Se descartó escribir ese `unsafe` aquí (más superficie para revisar y mantener) y se descartó `windows` a pelo por la misma razón.

## Detalles

- **Agrupación.** Las sesiones activas se agrupan por nombre de programa (sin distinguir mayúsculas). El `id` devuelto es el PID **raíz** del grupo: desde el PID de una sesión se sube por los padres mientras tengan el mismo nombre de programa; si hay varias raíces se toma el menor PID. Como se captura con el árbol de procesos, el audio de los hijos (Chrome, Discord, Firefox) entra.
- **Formato.** Se pide 48 kHz estéreo f32 con conversión automática y se pasa por `to_mono` / `Resampler` / `Chunker` existentes: trozos mono f32 a 16 kHz de 100 ms.
- **Fin de la aplicación.** El flujo de process loopback no da error cuando el proceso muere (solo calla), así que el hilo de captura comprueba cada segundo que el PID raíz sigue vivo (`sysinfo`, solo ese PID). Al morir (o fallar la lectura) se detiene, marca `ended()` y llama al aviso de `set_on_ended`.
- **Errores.** Proceso inexistente o versión de Windows anterior a 2004: `CoreError::Capture` descriptivo, sin dejar hilos. `stop` es idempotente.

## Límites conocidos

- Si el proceso raíz termina pero siguen vivos hijos que suenan, se considera que la aplicación terminó.
- El árbol se calcula al listar; un PID viejo de una lista antigua puede no existir al iniciar (error descriptivo).
