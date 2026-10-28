# Validación manual en Windows — audio por aplicación, medidor y controles

Cambio OpenSpec `audio-fuentes-y-controles`. Requiere Windows 10 2004 o posterior (captura por proceso), los modelos de texto y de audio descargados (pestaña Idiomas) y una voz clara en inglés.

## Preparación

1. `cd crates/tr-bindings && npm run build` y `cd app && npm run build && npx electron .` (sin `ELECTRON_RUN_AS_NODE` en el entorno).
2. Abrir la pestaña **Inicio**: debe ser la primera y mostrar estado, fuente, barra de nivel y botones.
3. Automáticas ya verificadas: `cargo test --workspace`, `cargo test -p tr-adapters --test audio_process_windows -- --ignored --test-threads=1`, `cd app && node --experimental-strip-types --test "src/**/*.test.ts"`.

## 1. Medidor de nivel

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Iniciar con modo audio y fuente «Todo el sistema» con un vídeo sonando | La barra se mueve y pasa la marca del umbral al haber voz |
| 1.2 | Bajar el volumen de Windows al mínimo | La barra queda bajo la marca y a los pocos segundos aparece «el audio llega demasiado bajo» |
| 1.3 | Pausar el vídeo | A los pocos segundos aparece «no llega audio de la fuente elegida» |
| 1.4 | Pausar o detener la traducción | La barra vuelve a cero y desaparecen los avisos |
| 1.5 | Elegir una aplicación con el volumen del sistema bajo | La barra sube igualmente (la captura por proceso no depende del volumen del sistema; medido: pico 0,65 con `ffplay`) |

## 2. Fuente por aplicación

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Reproducir en Firefox y abrir la lista | `firefox.exe` aparece en pocos segundos |
| 2.2 | Repetir con Chrome, Discord (en llamada) y un juego | Cada uno aparece una sola vez aunque tenga varios procesos |
| 2.3 | Elegir Firefox con un vídeo en Chrome sonando a la vez | Solo se traduce lo de Firefox |
| 2.4 | Cambiar de fuente con la traducción en marcha | La sesión se reinicia sola con la fuente nueva |
| 2.5 | Cerrar la aplicación elegida durante la sesión | Estado «esperando a <programa>» con aviso; al reabrirla y sonar, se reanuda |
| 2.6 | Cerrar y reabrir la aplicación con la app parada y pulsar Iniciar | Se vuelve a asociar por nombre de programa |
| 2.7 | Windows anterior a 2004 (si hay) | Mensaje claro; no se cae a «Todo el sistema» en silencio |

## 3. Controles

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Estado en reposo | Solo Iniciar habilitado |
| 3.2 | Iniciar, Pausar, Reanudar, Reiniciar y Detener | El estado y los botones cambian; Pausar pasa a Reanudar |
| 3.3 | Pulsar Reiniciar tres veces seguidas | Queda una única sesión (sin captura duplicada) |
| 3.4 | Iniciar sin modelos | Explica qué falta y su tamaño, con salto a la pestaña Idiomas |
| 3.5 | Cerrar y reabrir la ventana con la sesión en marcha | El estado inicial es el real, no «en reposo» |
| 3.6 | Modo automático con una aplicación elegida | Limitación conocida: el paso de texto a audio usa todo el sistema |

## 4. Rendimiento y privacidad

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Barra de nivel con la sesión larga | La ventana no se atasca ni sube el uso de CPU de forma notable |
| 4.2 | Revisar que no aparecen archivos de audio ni texto en `%APPDATA%\translate-app` y `%LOCALAPPDATA%\translate` salvo modelos y ajustes | Solo modelos y `settings.json` |
