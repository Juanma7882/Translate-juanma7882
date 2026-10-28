# macOS: audio por aplicación (validación manual)

Estado: **no disponible**. `cpal` 0.18.2 solo captura un dispositivo de salida entero (tap global
de CoreAudio, "loopback"); no expone el tap por proceso de macOS 14.4+ (`CATapDescription` sobre un
proceso concreto), y usar la API a mano exigiría `unsafe`, prohibido en `tr-adapters`.

Comprobar en un Mac (arm64 o x64):

- [ ] En Ajustes > Inicio, el selector de fuente ofrece solo "Todo el sistema" y muestra el motivo
      ("capturing a single application is not supported on this platform").
- [ ] Con "Todo el sistema", los subtítulos siguen funcionando igual que antes (Hito 3).
- [ ] Elegir una aplicación por ajustes importados o a mano no cierra la aplicación y avisa con el
      mismo mensaje.

Reabrir cuando `cpal` (o una caja segura) exponga el tap por proceso: enumerar con
`kAudioHardwarePropertyProcessObjectList` y capturar con un tap limitado al proceso elegido.
