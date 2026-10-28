# Validación manual en Windows — escucha previa del nivel

Cambio OpenSpec `audio-fuentes-y-controles` (grupo 7). Con **Inicio a la vista** y sin ninguna sesión, el motor abre la fuente elegida solo para medir su nivel y la barra se mueve aunque no se haya pulsado Iniciar. No necesita modelos.

Automatizado: `cargo test -p tr-core monitor` y `cargo test -p tr-engine --test audio_monitor` (motores de demostración), `cargo test -p tr-engine --test audio_monitor -- --ignored` (abre el dispositivo de salida real), `cd crates/tr-bindings && node --test test/audio-monitor.test.js`, `cd app && node --experimental-strip-types --test "src/**/*.test.ts"` y `TR_SMOKE=settings` (barra, sesión, «Solo texto», cambio de pestaña y ventana oculta con motores de demostración). Esta lista cubre lo que solo se comprueba con el dispositivo y los programas reales.

## Preparación

1. `cd crates/tr-bindings && npm run build` y `cd app && npm run build && npx electron .` (sin `ELECTRON_RUN_AS_NODE` en el entorno).
2. Ajustes: motor **Local** (Avanzado), modo **Automático** o **Solo audio**, fuente «Todo el sistema». No hace falta tener ningún modelo descargado.

## 1. La barra se mueve sin iniciar

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Abrir la app con un vídeo sonando, sin pulsar Iniciar | Bajo la barra aparece «Escuchando «Todo el sistema»…» y la barra se mueve con el sonido |
| 1.2 | Pausar el vídeo | La barra baja a cero; la nota sigue diciendo que escucha |
| 1.3 | Sin ningún modelo descargado | La barra se mueve igual |
| 1.4 | Volumen de Windows muy bajo | La barra apenas se mueve y a los pocos segundos aparece «el audio llega demasiado bajo» (con «Todo el sistema» el nivel depende del volumen del sistema; medido en esta máquina con un sonido de Windows: rms máx 0,0008) |
| 1.5 | Elegir otra fuente en el selector con la escucha activa | En unos instantes la barra pasa a reflejar la fuente nueva |

## 2. Sesión

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Pulsar Iniciar con la barra moviéndose | La nota desaparece, la barra sigue con el nivel de la sesión y no se pierde ni se duplica ningún dato |
| 2.2 | Durante la sesión, mirar los dispositivos de audio de Windows (Mezclador de volumen o Monitor de recursos) | Una sola captura abierta por la app |
| 2.3 | Detener la sesión con Inicio a la vista | La nota «Escuchando…» vuelve y la barra se mueve de nuevo |
| 2.4 | Pausar y reanudar | Mientras está en pausa la barra queda a cero; no vuelve la escucha |
| 2.5 | Iniciar sin modelos | Explica qué falta; la barra sigue moviéndose |

## 3. Cuándo NO debe escuchar

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Elegir el modo «Solo texto» | La barra no se mueve y dice que ese modo no usa el audio |
| 3.2 | Cambiar a otra pestaña (General) con un vídeo sonando | La app deja de capturar (ya no hay captura abierta); al volver a Inicio se reanuda |
| 3.3 | Minimizar la ventana de Ajustes | La escucha se detiene; al restaurarla se reanuda |
| 3.4 | Cerrar la ventana de Ajustes (la app sigue en la bandeja) | No queda ninguna captura de audio abierta por la app |
| 3.5 | Cerrar y reabrir la ventana desde la bandeja | La escucha empieza sola al ver Inicio |

## 4. Fuente por aplicación y fallos

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Elegir una aplicación que no está sonando | «Esperando a que suene <programa>…»; empieza sola al sonar |
| 4.2 | Cerrar la aplicación elegida durante la escucha | Pasa a «Esperando…» en pocos segundos |
| 4.3 | Sin dispositivo de salida (desactivar los altavoces en Windows) | «No se pudo escuchar el audio: …» junto a la barra, sin avisos de sesión ni estado de error de la sesión |
| 4.4 | Volver a activar el dispositivo y cambiar de pestaña y volver a Inicio | La escucha se reintenta y funciona |
| 4.5 | Cambiar el motor entre Local y Demostración en Avanzado | La escucha sigue la elección (la demostración mueve la barra a ráfagas) |

## 5. Privacidad

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 5.1 | Mientras escucha, buscar archivos de audio nuevos en la carpeta de datos de la app y en `%TEMP%` | No aparece ninguno: solo se calcula un nivel por trozo |
| 5.2 | Mirar el aviso bajo la barra | Dice que no se guarda ni se traduce nada hasta pulsar Iniciar |

## macOS (anotar al validar)

La primera vez que Inicio esté a la vista, macOS puede pedir el permiso de captura de audio en ese momento, no al pulsar Iniciar. Anotar si el aviso es claro.
