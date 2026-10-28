# Proposal

## Why

Hoy el audio se captura siempre del dispositivo de salida completo y no hay forma de saber si está llegando señal: en Windows, con el volumen bajo, el detector de voz (umbral RMS 0,01) descarta todo en silencio y el usuario solo ve un overlay vacío. Además no se puede limitar la captura a una aplicación (un vídeo en Firefox sin los avisos de Discord, un juego…) y la única forma de controlar la sesión es la bandeja del sistema. Hacen falta feedback visible del nivel, elegir la fuente y controles claros.

## What Changes

- Medidor de nivel (barrita) con el nivel del audio capturado, visible en la ventana principal mientras haya captura; marca cuándo el nivel queda por debajo del umbral de voz.
- Elección de fuente de audio: **todo el sistema** (como ahora) o **una aplicación concreta**. Lista de aplicaciones que están sonando, actualizada en vivo; la elección se guarda en los ajustes.
- Captura por aplicación por plataforma: Windows con WASAPI *process loopback* (Windows 10 2004 o posterior), Linux con el *sink-input* de PulseAudio/PipeWire, macOS con tap por proceso. Si la plataforma no lo permite, se informa y se mantiene "todo el sistema".
- Controles **Iniciar, Pausar, Reiniciar** (y Detener) en la ventana principal, con el estado visible (en reposo, traduciendo, en pausa, error). Reiniciar vuelve a abrir la captura con la fuente y ajustes actuales.
- El motor emite el nivel de audio como evento nuevo con un valor numérico por ventana de ~100 ms; nunca audio ni texto.
- **Escucha previa del nivel**: sin pulsar Iniciar, en cuanto Inicio está a la vista, el motor abre la fuente elegida solo para medir su nivel (sin modelos, sin reconocer voz ni traducir, sin guardar audio) y la barra se mueve si hay sonido, para que el usuario sepa que se está capturando. Cede en cuanto empieza una sesión, no se activa en «Solo texto» y se detiene si Inicio deja de verse.
- La app sigue arrancando sin modelos: los controles se deshabilitan con una explicación y un enlace a la pestaña Idiomas si faltan modelos.

No cambia (fuera de alcance): el umbral del detector de voz ni su adaptación al volumen (cambio aparte; el medidor sirve para diagnosticarlo); captura de micrófono; mezcla de varias aplicaciones a la vez.

## Capabilities

### New Capabilities
- `audio-level-meter`: cálculo y emisión del nivel de audio capturado y su barra en la interfaz, con indicación de nivel bajo el umbral de voz.
- `audio-source-selection`: enumeración de aplicaciones con audio, elección de la fuente (sistema o aplicación) y su persistencia en los ajustes.
- `session-controls`: botones Iniciar, Pausar, Reiniciar y Detener con estado visible en la ventana principal.

### Modified Capabilities
- `system-audio-capture`: la captura admite una fuente (sistema o proceso) y reporta cuando esa fuente desaparece.
- `js-bridge`: nuevos eventos (nivel) y órdenes (listar fuentes, elegir fuente) en el puente.

## Impact

- **Rust**: `tr-core` (puerto de captura con fuente y evento de nivel, solo traits), `tr-adapters` (captura por proceso en Windows/Linux/macOS; nueva dependencia de Windows para WASAPI process loopback, a verificar según la regla 5), `tr-engine` (nivel y fuente en `start_audio`; escucha previa que cede ante las sesiones), `tr-bindings` (eventos y órdenes napi, incluidas las de la escucha previa).
- **Electron/TS**: protocolo del motor, `AppController` (reiniciar, fuente), ajustes (campo de fuente), ventana principal con medidor, selector de fuente y botones; el evento de nivel llega a ~10 Hz y debe agruparse para no saturar el IPC.
- **Riesgos**: la captura por proceso depende de la versión del sistema; enumerar aplicaciones con audio es distinto en cada plataforma; en macOS requiere permiso adicional. Windows es la plataforma de validación primaria de este cambio.
- **Reglas**: todo en RAM (el nivel es un número, el audio no sale del hilo de captura), `core` solo conoce traits, la UI no se bloquea.
