# Validación manual en Windows — Inicio y primer uso (`ui-inicio-y-primer-uso`)

Automatizado: la lógica de la guía, la región, el menú de idiomas y las marcas (`home-start.test.ts`), el IPC de
«Cambiar región» (`session-ipc.test.ts`), los colores (`style-contrast.test.ts`) y el smoke `TR_SMOKE=settings`
(guía de tres pasos que se completa sola, región, modo en Inicio y en General, vista previa fija, posición plegada).
Esta lista cubre lo que **solo** se ve con ojos, ratón y lector de pantalla reales. Marca cada punto y anota el resultado.

## Preparación

1. Construir como en `windows-hito-2.md` (`cd app && pnpm run build`).
2. Para el punto 1 hace falta un perfil nuevo: cerrar la app y borrar la carpeta `Local Storage` del perfil de la app
   en `%APPDATA%` (la marca de «guía terminada» vive ahí), y quitar `lastRegion` del archivo de ajustes o usar «Restablecer».

## 1. Primer uso

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Abrir la app sin modelos ni región | Inicio es la primera pestaña; «Para empezar» muestra tres pasos; el primero («Descarga un idioma») está destacado con el botón «Ir a Idiomas» |
| 1.2 | Pulsar «Ir a Idiomas», descargar un par y volver a Inicio | El primer paso figura «Hecho:» (con texto, no solo tachado) y se destaca «Elige la región» |
| 1.3 | Pulsar «Elegir región» y dibujar una región en el selector | El selector aparece encima de todo, la región se guarda, empieza a traducir y vuelve el foco a Ajustes; la guía pasa a «Inicia la traducción» |
| 1.4 | Iniciar, detener y cerrar y abrir la ventana de Ajustes | La guía desapareció y no vuelve; la fila Región muestra el tamaño y la posición |
| 1.5 | Borrar un modelo después de terminar la guía | La guía no reaparece; Inicio avisa de los modelos que faltan al pulsar Iniciar |
| 1.6 | Elegir «Solo audio» con una instalación nueva | La guía tiene dos pasos (sin región) y la fila Región dice que no se necesita |

## 2. Qué se traduce

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | «Cambiar región» con una sesión en marcha | Se abre el selector; al cancelar (Esc) no hay error y la región anterior sigue; al confirmar traduce la nueva |
| 2.2 | «Cambiar región» con el selector en un segundo monitor | La región guardada indica «pantalla 2» |
| 2.3 | Menú de idiomas en reposo con dos pares instalados | Solo salen los pares instalados; cambiar de par se guarda y la pestaña Idiomas marca «(en uso)» el elegido |
| 2.4 | Menú de idiomas con la sesión en marcha | Deshabilitado, con «Detén la sesión para cambiar de idioma» |
| 2.5 | Cambiar el modo en Inicio y en General | Ambos reflejan el cambio sin recargar; la frase de Inicio se actualiza |

## 3. Idiomas, Motores y Apariencia

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Pestaña General | No hay selectores «Traducir desde/a» ni Motor; el par se gestiona en Idiomas |
| 3.2 | Pestaña Avanzado | «Motores (solo para pruebas)» explica que la demostración no traduce de verdad |
| 3.3 | Apariencia: desplazarse hasta Colores con la ventana baja | La vista previa sigue a la vista, con fondo opaco, y refleja el cambio de color; con 6 líneas y letra grande no tapa los controles (altura limitada) |
| 3.4 | Posición: botón y coordenadas | «Mover el overlay…» es lo primero; con posición manual, «Coordenadas exactas (X, Y)» está plegado y se abre con Enter o Espacio |

## 4. Accesibilidad y tema

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Recorrer Inicio solo con Tab | Orden lógico: guía, estado y botones, región, idiomas, modo, audio; anillo de foco visible |
| 4.2 | Narrador / NVDA: completar un paso de la guía | Se anuncia «Paso completado: …» y cuál sigue |
| 4.3 | Narrador / NVDA: cambiar de estado de la sesión | Se anuncia el estado (ya existente) |
| 4.4 | Tema claro y oscuro del sistema | Estado, guía, botón principal y filas legibles en ambos; los pasos hechos se distinguen sin depender del color |
| 4.5 | Ventana estrecha (≈ 500 px) | Las filas se pliegan sin desbordar; sin scroll horizontal |
