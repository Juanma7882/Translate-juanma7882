# Validación manual en Windows — Guardar transcripción

Cambio OpenSpec `guardar-transcripcion` (spec `transcript-saving`, ADR 0011).

Verificado con pruebas automáticas en Windows: formato `.txt`/`.srt`, escritor (parciales, repetidos, pausa,
activar/desactivar en vivo, nombres sin sobrescribir, carpeta borrada), guardas de «nada a disco» con el ajuste
apagado, la bandeja, y los smokes `settings`, `overlay`, `shell` y `e2e` real (la línea reconocida y traducida
queda en `.txt` y `.srt`). Esta lista cubre lo que solo se ve con la aplicación de verdad: diálogo nativo,
bandeja real, notificaciones, audio real y abrir el `.srt` en un reproductor. Marca cada punto y anota el resultado.

## Preparación

1. Construir y arrancar la aplicación como en `windows-hito-2.md`, con los modelos de texto y de audio (`fetch -- <carpeta> en es all`).
2. Crear una carpeta vacía, p. ej. `C:\Users\<usuario>\Documents\transcripciones`.

## 1. Ajustes

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Primer arranque: Ajustes > General > «Guardar transcripción» | Casilla desmarcada y deshabilitada; «Carpeta: ninguna elegida» |
| 1.2 | «Elegir carpeta…» y elegir la carpeta del paso 2 | Diálogo nativo titulado «Carpeta para guardar la transcripción»; la ruta aparece y la casilla se habilita |
| 1.3 | Marcar «Guardar la transcripción» sin sesión | No aparece ningún archivo en la carpeta |
| 1.4 | Elegir una carpeta de solo lectura (p. ej. `C:\Windows`) | Mensaje junto al botón; la carpeta anterior se conserva |
| 1.5 | Avanzado > Exportar… con el guardado activo y abrir el JSON | No contiene `transcript` ni la ruta |
| 1.6 | Avanzado > Restablecer… | El guardado queda desactivado y la carpeta sigue elegida |

## 2. Sesión de audio

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Modo «Solo audio», reproducir un vídeo con voz en inglés e iniciar | Píldora roja «● Guardando transcripción» en el overlay (también sin subtítulo visible); la bandeja dice «guardando transcripción» |
| 2.2 | Abrir el `.txt` con el Bloc de notas durante la sesión | Las líneas finales aparecen a medida que llegan (`[HH:MM:SS] [en] …` + `[es] …`), sin parciales |
| 2.3 | Pausar 20 s y reanudar | Mismos archivos; las horas siguientes saltan ~20 s |
| 2.4 | Detener y abrir el `.srt` junto al vídeo en VLC o el reproductor de Windows | Subtítulos en orden, cada uno con original y traducción, sin solaparse |

## 3. Texto en pantalla y modo automático

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Modo «Solo texto» sobre un texto fijo durante 30 s | El texto aparece una sola vez en la transcripción |
| 3.2 | Modo automático: texto, quitarlo (pasa a audio) y volver | Un único par de archivos con líneas de ambos modos en orden |

## 4. En vivo, errores y bandeja

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Con una sesión en marcha, desmarcar «Guardar transcripción» en la bandeja | Desaparece el indicador; el `.txt` deja de crecer; la traducción sigue |
| 4.2 | Volver a marcarlo | Archivos nuevos (sufijo `-2` si coincide el segundo); solo líneas posteriores, con la hora desde el inicio de la sesión |
| 4.3 | Con la sesión guardando, borrar la carpeta en el Explorador | Notificación «No se pudo guardar la transcripción… la traducción sigue» sin ruta ni texto; desaparece el indicador; la traducción sigue |
| 4.4 | Detener e iniciar otra sesión (carpeta recreada) | Vuelve a guardar en archivos nuevos |
| 4.5 | Con la carpeta abierta en el Explorador, comprobar `%APPDATA%\translate-app` y `%TEMP%` | Ningún texto reconocido ni traducido fuera de la carpeta elegida |
