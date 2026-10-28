# Validación manual en Windows — Hito 2 (texto en pantalla)

El desarrollo se hizo en WSL (Ubuntu): ahí se verificó todo lo que no depende del sistema de ventanas
de Windows. Esta lista cubre lo que **solo** se puede comprobar en Windows nativo. Marca cada punto y
anota el resultado; cualquier fallo se registra como incidencia antes de dar por cerrado el hito.

## Preparación

1. Clonar el repositorio en Windows (no dentro de WSL) con Rust (`rustup`, MSVC), Node 22 y las
   herramientas de compilación de Visual Studio.
2. `cd crates/tr-bindings && pnpm run build` (genera el `.node` de Windows).
3. `cd app && pnpm run build && pnpm exec electron .`
4. Para tener los modelos sin esperar a la primera descarga:
   `cargo run --release -p tr-models --example fetch -- <carpeta> en es`.

Pruebas automáticas que ya deberían pasar en Windows: `cargo test --workspace`,
`cd app && pnpm test`, `TR_SMOKE=windows|selector|flow|overlay|settings|shell` con `electron .`.

## 1. Captura real

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Abrir un navegador con un texto en inglés grande, elegir la región sobre él desde la bandeja | El overlay muestra la traducción en español en pocos segundos |
| 1.2 | Cambiar el texto de la página | La traducción se actualiza; con el texto quieto no se repite ni parpadea |
| 1.3 | Seleccionar una región sin texto (fondo liso o imagen) | No aparece traducción ni aviso de error |
| 1.4 | Mover la ventana del navegador fuera de la región | La traducción deja de actualizarse y no hay errores |
| 1.5 | Mirar en el Administrador de tareas el uso de CPU durante 1 minuto con texto quieto | CPU baja (el motor no procesa fotogramas sin cambios) |

## 2. DPI y escala

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Con escala 100 %, 125 %, 150 % y 200 % elegir una región sobre un texto conocido | La región capturada coincide con lo seleccionado (el texto se reconoce completo) |
| 2.2 | Con escala 150 % comprobar la posición del overlay | Queda junto a la región, sin desplazamientos |
| 2.3 | Cambiar la escala con la app abierta, volver a elegir región | Funciona sin reiniciar |

## 3. Varios monitores

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Dos monitores con distinta escala: elegir región en el secundario | Se captura el monitor correcto; el selector aparece en el monitor donde está el cursor |
| 3.2 | Monitor secundario a la izquierda o encima del principal (coordenadas negativas) | Región y overlay se colocan bien |
| 3.3 | Reiniciar la app y usar «Traducir la última región» | Reutiliza la región en su monitor; si el monitor ya no existe, avisa y pide elegir otra |

## 4. Overlay

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Hacer clic sobre el overlay | El clic llega a la ventana de debajo (clic a través) |
| 4.2 | Usar otra aplicación a pantalla completa en ventana | El overlay sigue encima |
| 4.3 | Teclear en otra aplicación mientras el overlay está visible | El overlay no roba el foco |
| 4.4 | Grabar la pantalla con la Barra de juegos (Win+Alt+R) o capturar con Win+Shift+S | El overlay **no aparece** en la captura (exclusión de captura) |
| 4.5 | Cambiar opacidad, fuente y tamaño en Ajustes con el overlay visible | Cambian en vivo, sin reiniciar |
| 4.6 | Poner la posición manual sobre la región | Aparece el aviso de que el overlay tapa la región |

## 5. Atajos globales

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 5.1 | `Ctrl+Shift+T` con otra aplicación en primer plano | Abre el selector de región |
| 5.2 | `Ctrl+Shift+P` con la traducción en marcha | Pausa; otra vez, reanuda |
| 5.3 | Cambiar un atajo en Ajustes a una combinación libre | El nuevo funciona y el anterior deja de hacerlo |
| 5.4 | Poner un atajo que ya usa otra aplicación | Aviso de que no se pudo registrar, con el atajo y la indicación de cambiarlo |

## 6. Juegos y reproductores

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 6.1 | Juego en **ventana sin bordes** con texto en inglés | Se captura y traduce; el overlay se ve encima |
| 6.2 | Juego en **pantalla completa exclusiva** | Anotar el comportamiento: lo esperado es que la captura funcione solo con DXGI/ventana sin bordes y que el overlay no se vea; no es un fallo del hito, queda documentado |
| 6.3 | Reproductor de vídeo con subtítulos incrustados | Se reconoce y traduce el texto de los subtítulos |

## 7. Contenido protegido (DRM)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 7.1 | Región sobre un vídeo de un servicio con DRM (p. ej. Netflix en navegador) | La captura sale negra: no hay traducción y **no se muestra un error** (se trata como pantalla sin texto) |

## 8. Descarga de modelos (primer uso)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 8.1 | Borrar la carpeta de modelos y elegir una región | Aviso de modelos ausentes y se abre Ajustes con el tamaño total y la nota de que necesita internet |
| 8.2 | Pulsar «Descargar modelos» | La barra avanza sin retroceder; al terminar, la traducción pendiente arranca sola |
| 8.3 | Cortar la red a mitad de la descarga | Error comprensible y botón «Reintentar descarga»; al reintentar completa |
| 8.4 | Con los modelos descargados, desconectar la red y traducir | Funciona sin conexión |

## 9. Privacidad (regla «todo en RAM»)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 9.1 | Traducir unos minutos y buscar en `%APPDATA%`, `%TEMP%` y la carpeta de modelos el texto mostrado | No aparece en ningún archivo; solo `settings.json` y los modelos |
| 9.2 | Abrir `settings.json` | Solo preferencias y la última región (números), nunca texto capturado o traducido |

## Registro de resultados

| Fecha | Versión / commit | Windows | Escala | Monitores | Puntos fallidos | Notas |
|---|---|---|---|---|---|---|
| | | | | | | |
