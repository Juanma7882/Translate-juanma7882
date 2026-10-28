# Validación manual en Windows y macOS — Hito 5B (modelos y ajustes)

En WSL se verificó con pruebas automáticas: descargas contra un servidor HTTP local con `Range` y fallos
(cancelar, cortar la red, reanudar, 416, servidor sin `Range`, parcial corrupto), borrado seguro, validación
de carpetas, los modelos nuevos con una frase real (`tr-engine/tests/real_pairs.rs`) y los smokes de Electron
(`settings`, `shell`, `overlay`, `windows`, `e2e`) bajo Xvfb. Esta lista cubre lo que **solo** se puede comprobar
en Windows y macOS (diálogos nativos, ratón real, tema del sistema, unidades y permisos). Marca cada punto y
anota el resultado.

## Preparación

1. Construir como en `windows-hito-2.md`.
2. Pruebas automáticas que deberían pasar: `cargo test --workspace` y `cd app && npm test`.
3. Conexión a internet para descargar (≈ 115 MB por par de traducción nuevo).

## 1. Modelos

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Ajustes > Modelos: la lista de instalados muestra el espacio por modelo y el total; comparar con el Explorador de archivos / Finder | Los tamaños coinciden con el disco (en MB decimales) |
| 1.2 | Iniciar la descarga de un par nuevo (p. ej. inglés -> francés) y pulsar "Cancelar descarga" al 30 % | Mensaje de cancelación; en la carpeta queda `*.part`; el botón dice "Reanudar descarga" |
| 1.3 | Pulsar "Reanudar descarga" | Termina; el progreso parte de lo ya descargado y no vuelve a empezar de 0 |
| 1.4 | Cortar el wifi a mitad de una descarga y volver a conectarlo; reanudar | Error visible, parcial conservado, reanuda y verifica |
| 1.5 | Con un antivirus activo, descargar y borrar un modelo | Sin errores de acceso; el modelo desaparece de la lista y del disco |
| 1.6 | Borrar con la traducción en marcha | Los botones "Borrar" están desactivados y se explica el motivo |
| 1.7 | Cambiar la carpeta de modelos con "Examinar…" (diálogo nativo) | Se guarda; la lista de instalados pasa a ser la de la nueva carpeta; los modelos antiguos no se tocan |
| 1.8 | Carpeta en una unidad de red, USB desconectado, carpeta de solo lectura, ruta con espacios, tildes o `ñ` | Se rechaza con el motivo o funciona; nunca falla en silencio |
| 1.9 | Ruta larga (> 260 caracteres) en Windows | Se informa el error o funciona; sin cuelgues |
| 1.10 | Probar cada par nuevo (en<->fr, en<->de, en<->it, es<->fr) con texto real en pantalla | La traducción es razonable (no se espera calidad perfecta) |

## 2. Ajustes

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Tema del sistema claro/oscuro: cambiarlo con Ajustes abierta | La ventana cambia de tema sin reiniciar; texto legible en ambos |
| 2.2 | Modo de alto contraste de Windows / "Aumentar contraste" de macOS | Bordes y foco visibles |
| 2.3 | Lector de pantalla (Narrador, NVDA o VoiceOver): recorrer pestañas, cambiar un valor inválido, borrar un modelo, importar | Se anuncian pestañas, errores y resultados; el foco queda en un lugar lógico |
| 2.4 | Solo teclado: Tab/Mayús+Tab, flechas en las pestañas, Inicio/Fin, Enter y Espacio en botones | Todo es alcanzable y el orden es lógico |
| 2.5 | Escala de pantalla 125 %, 150 % y 200 % | Nada queda cortado; la ventana se puede desplazar |
| 2.6 | Exportar preferencias y abrir el archivo en un editor | No hay región, rutas de carpetas ni texto; solo preferencias |
| 2.7 | Importar el archivo en otro equipo / perfil | Se aplican las preferencias; la región y la carpeta del equipo no cambian |
| 2.8 | Importar un archivo editado a mano con un valor inválido | No se aplica nada y se explica el campo |
| 2.9 | Restablecer valores por defecto | Vuelven los valores iniciales; la región y la carpeta de modelos se conservan |

## 3. Overlay

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Cambiar color de texto y de fondo; probar combinaciones de poco contraste | Las de contraste < 4,5:1 se rechazan con aviso; las válidas se aplican al instante |
| 3.2 | Texto amarillo sobre fondo negro y texto negro sobre fondo blanco en un vídeo real | Legible; la sombra del texto no ensucia |
| 3.3 | Límite de líneas 1, 2 y 6 con una frase larga | Se corta con puntos suspensivos y la ventana ajusta su alto |
| 3.4 | "Mover el overlay…": arrastrar con el ratón real, también entre dos monitores y con escalas distintas (100 % / 150 %) | El overlay sigue al puntero sin saltos; no sale de la pantalla; "Listo" lo fija |
| 3.5 | Tras mover, iniciar una traducción | El overlay aparece donde se dejó (posición manual) |
| 3.6 | Mover con una aplicación a pantalla completa debajo (juego en ventana sin bordes, vídeo) | El overlay sigue encima y recibe el ratón en el modo mover |
| 3.7 | Terminar el modo mover y hacer clic donde está el overlay | El clic atraviesa el overlay (vuelve a ser transparente al ratón) |
| 3.8 | macOS: el overlay en modo mover sobre un Space a pantalla completa | Visible y arrastrable |

## 4. Rendimiento (puente con 5A)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Avanzado > Rendimiento: hilos 4, haz 3, caché 512, y luego 0 en todo | Se guardan; los valores fuera de rango se rechazan junto al campo |
| 4.2 | Iniciar una traducción tras cambiarlos | Sin errores; si 5A ya consume los valores, comprobar el efecto en la latencia |

## Resultados

Anotar versión del sistema, hardware, qué puntos fallaron y capturas si procede.
