# Design

## Context

Repo vacío; toolchain en WSL (Ubuntu): Rust 1.99, gcc 13, sin Node (el Node que hay es el de Windows). Las decisiones de fondo ya están en `docs/adr/0001-ui-stack.md` y `docs/adr/0002-architecture.md`; este documento solo baja a detalle lo que necesita el Hito 1. Motivación y alcance: ver `proposal.md`; requisitos: ver `specs/`.

## Goals / Non-Goals

**Goals:**
- Contratos de los puertos estables, de modo que el Hito 2 solo agregue adaptadores.
- Pipelines deterministas y testeables sin reloj real, hardware ni modelos.
- Validar de punta a punta napi-rs dentro de un utility process de Electron.

**Non-Goals:**
- Adaptadores reales, `tr-adapters`, `tr-models`.
- Ventanas de producto, atajos globales, tray.
- Empaquetado, CI, firma de código.
- Rendimiento fino (medición de RAM/CPU/latencia es del Hito 5).

## Decisions

### D1. Estructura del workspace
`crates/tr-core`, `crates/tr-engine`, `crates/tr-bindings` y `app/` (electron-vite). `tr-adapters` y `tr-models` se crean en hitos posteriores. `tr-core` solo depende de `thiserror`, `crossbeam-channel` y `lru`; sin tokio, sin I/O.

### D2. Modelo de concurrencia
- Cada pipeline corre en hilos propios: captura -> `LatestSlot` -> worker (`CaptureLoop`, reutilizado por el pipeline de región y el de fallback).
- La espera entre capturas es interrumpible (canal de parada con `recv_timeout`): `stop()` vuelve en decenas de ms aunque el intervalo sea de segundos. Es lo que permite que los comandos no bloqueen al llamador JS.
- `LatestSlot<T>` (`Mutex<Option<T>>` + `Condvar`) implementa "último gana": un productor sobrescribe, el consumidor toma el más reciente. Se prefiere a un canal acotado porque descartar el viejo es el comportamiento deseado y evita bloquear al productor.
- Eventos y control usan canales de `crossbeam-channel`.
- *Alternativa descartada:* tokio con tareas async; agrega runtime y contagio de `async` a traits que solo hacen trabajo de CPU.

### D3. Puertos (firmas de intención)
- `ScreenCapture::grab(&Region) -> Result<Frame>`
- `OcrEngine::recognize(&Frame, Lang) -> Result<Vec<TextBlock>>`
- `AudioCapture::start(Box<dyn FnMut(AudioChunk) + Send>) / stop()`
- `SpeechToText::push(AudioChunk) -> Result<Vec<Segment>>` (parcial o final)
- `Translator::translate(&str, Lang, Lang) -> Result<String>`
- `EventSink::emit(Event)` (no bloqueante) y `Clock::now()` / `sleep`.
Todos `Send + Sync` salvo donde el motor lo impida; los pipelines reciben `Arc<dyn Trait>` o `Box<dyn Trait>` por constructor. Los fakes permiten programar respuestas, latencias y fallos.

### D4. Detección de cambio y estabilización
- Cambio: se reduce el frame a una cuadrícula en escala de grises (p. ej. 32x32 por promedio de bloques) y se compara con la anterior por diferencia media absoluta contra un umbral configurable. Es barato y no requiere dependencias.
- Estabilización: el texto normalizado (trim, espacios colapsados) debe coincidir en 2 frames consecutivos antes de emitirse. N=2 es configurable. Un frame sin cambio cuenta como una observación más del último texto (sin OCR); si no, un subtítulo estático nunca se estabilizaría. Un fallo de OCR o de traducción reinicia detector y estabilizador para reintentar.
- Caché: `lru::LruCache<(String, Lang, Lang), String>` tras un `Mutex`; la clave usa texto normalizado y en minúsculas; capacidad configurable (por defecto 256).

### D5. AudioPipeline
- Formato interno: f32 mono 16 kHz; el adaptador de captura es responsable de convertir.
- VAD por energía RMS con umbral y tiempo mínimo de habla; sin dependencias.
- Ventanas de ~2 s con solape de ~0,5 s; la deduplicación del solape se hace comparando el sufijo/prefijo del texto de ventanas consecutivas.
- Se traducen solo los segmentos finales; los parciales se emiten sin traducir. Solo los finales sirven de contexto para quitar el solape: si un parcial lo hiciera, el final siguiente quedaría recortado.

### D6. State machine de texto/audio
- Función pura `step(estado, observación{hay_texto, ahora}) -> (estado, acciones)`; las acciones (`StartAudio`, `StopAudio`, `EmitModeChanged`) las ejecuta el orquestador. Sin I/O, probada con `FakeClock`.
- Umbrales por defecto: 3 s sin texto para pasar a audio, 1 s con texto para volver. En modo audio la región se sigue vigilando a baja frecuencia.
- Estados: `Text`, `Audio`, `Paused { previo }`.

### D7. Composición
`tr-engine` expone `Engine::new(config, sink)`; con `engines = Fake` (único valor en este hito) cablea los fakes. La selección por SO y configuración llega en el Hito 2 sin tocar `tr-core`.

### D8. Binding napi-rs
- Funciones de módulo `startRegionTranslation`, `startAudioSubtitles`, `stop` y registro de callbacks para los 4 eventos vía `ThreadsafeFunction`; un `Engine` único por proceso detrás de un `Mutex`.
- Los comandos validan argumentos (región no vacía, idiomas soportados) y retornan error sin iniciar nada.
- Ningún tipo de `Frame` ni `AudioChunk` se expone a JS.
- Hook de pánico propio que registra solo ubicación y tipo, nunca el payload, porque el mensaje podría contener texto capturado. *Implementado en `tr-core::panic_hook`* (no en el binding): los binarios de test de un crate napi no enlazan (símbolos N-API sin resolver), y así tiene un test real. El binding lo instala con `#[module_init]`.
- Se usa `@napi-rs/cli` para compilar y generar los tipos de TypeScript. Los callbacks se declaran con `ts_args_type` porque el generador no resuelve el alias `Callback<T>`; usan referencia débil para no mantener vivo el bucle de Node.
- **Capa `api.js`** sobre el módulo generado: varios suscriptores con baja y la garantía de "nada tras `stop()`", incluidos los eventos ya encolados hacia JS (a nivel nativo no se pueden recuperar). Un arranque con argumentos inválidos (`code === 'InvalidArg'`) no toca la sesión activa.
- API añadida respecto al plan original: `configure(options)` (intervalo, fallback y sus tiempos, latencia simulada) y el evento `onModeChanged`; el núcleo ya emitía cambios de modo y los ajustes de motores/fallback necesitan un punto de entrada.
- Versiones fijadas (verificadas 2026-10-27, MIT): `napi` 3.15.0, `napi-derive` 3.6.13, `napi-build` 2.6.0 (MSRV 1.88, por lo que el workspace pasó a `rust-version = "1.88"`), `@napi-rs/cli` 3.10.9.

### D9. Electron mínimo
- `electron-vite` con main y preload; sin renderers de producto.
- `main` hace `utilityProcess.fork()` de un script que hace `require` del `.node`; la comunicación con main es por mensajes (`parentPort`). El canal queda listo para pasar un `MessagePort` directo a los futuros renderers.
- Supervisión: si el utility process sale con código distinto de 0, main notifica y reinicia con backoff.
- Verificación: un script de humo (`TR_SMOKE=1`) arranca la app, inicia una traducción con motores de demostración, espera un evento, rechaza argumentos inválidos, fuerza dos caídas del proceso del motor (comprueba que main sigue vivo, que reinicia y que la espera crece 250 -> 500 ms), repite la traducción y sale con código 0 o 1.
- Versiones fijadas: Electron 44.9.3, electron-vite 5.0.0, Vite 7.3.7, TypeScript 5.9.3. Se prefirieron a las últimas majors (Electron 45 y electron-vite 6 tenían días o semanas de vida).
- Sin preload ni renderers en este hito, por lo que `electron-vite` avisa "renderer and preload config is missing" (esperado).

### D10. Garantías de "nada a disco"
- `clippy.toml` con `disallowed-methods` para `std::fs::write`, `File::create`, `File::create_new`, `OpenOptions::open`, `fs::copy`, etc.; `-D warnings` en CI local. `tr-models` (futuro) queda exento con `#![allow]` justificado.
- Regla de logging: solo metadatos. Se garantiza por construcción: lints `print_stdout`, `print_stderr` y `dbg_macro` en `deny` a nivel de workspace, y un test (`no_content_leaks`) que escanea el código de producción de `tr-core` y `tr-engine` en busca de APIs de impresión y de escritura a disco, y comprueba que una ejecución completa no crea archivos. (El plan original proponía capturar logs; no hay logging que capturar, así que se prohíbe en vez de vigilarlo.)
- `unsafe` se prohíbe con `#![forbid(unsafe_code)]` en `tr-core` y `tr-engine`; `tr-bindings` no puede (las macros de napi generan código unsafe).

### D11. Entorno de desarrollo del Hito 1
Todo corre en WSL: se instala Node 22 con nvm (sin sudo) y Electron se ejecuta con WSLg, de modo que el `.node` es de Linux. Esto basta porque el Hito 1 solo usa fakes. Para el Hito 2 (captura de pantalla y audio reales) habrá que desarrollar y probar en Windows nativo; se decide entonces (ver Open Questions).

## Risks / Trade-offs

- [Cross-OS: el `.node` de WSL no carga en el Electron de Windows] -> En este hito todo se ejecuta en Linux/WSLg; el cambio de entorno se planifica antes del Hito 2.
- [WSLg no disponible o inestable] -> Usar `xvfb` para la prueba de humo; el flujo solo necesita un proceso principal, no ventanas.
- [Versiones de `napi`/`@napi-rs/cli` cambian de API] -> Verificar versión y mantenimiento antes de fijar (regla del proyecto) y fijar versiones exactas.
- [Umbral de detección de cambio mal calibrado] -> Parámetros configurables y tests con frames sintéticos; calibración real en el Hito 2.
- [Deduplicación del solape de audio es heurística] -> Cubierta con tests de casos límite; se revisa con STT real en el Hito 3.
- [Pánico con payload sensible] -> Hook propio de pánico que no registra el mensaje.
- [Sobre-ingeniería del esqueleto] -> Solo lo necesario para los specs; nada de adaptadores ni UI.

## Open Questions

- Entorno de desarrollo desde el Hito 2: ¿mover el checkout a Windows nativo o desarrollar con cross-compilación? Se resuelve antes de iniciar el Hito 2; no afecta a este hito.
- Valores por defecto finales de umbrales (cambio, VAD, 3 s / 1 s) se ajustarán con datos reales.
