# Validación manual: idiomas y subtítulos (Windows / macOS)

Requisitos: modelos de OCR del inglés y de traducción `en->es` y `en->fr` descargados (pestaña Idiomas, «Descargar»).

1. **Origen y destinos por separado**: en Ajustes > Idiomas elige «El contenido está en… inglés». «Subtítulo 1» ofrece inglés (texto original), español y francés; el segundo subtítulo, desactivado, se activa con «Mostrar un segundo subtítulo».
2. **Un subtítulo**: deja solo «inglés (texto original)». Inicia sobre una región con texto en inglés: el overlay muestra únicamente el texto leído; no hace falta ningún modelo de traducción (borra `en->es` para comprobarlo y vuelve a descargarlo).
3. **Original y traducción**: subtítulo 1 inglés, subtítulo 2 español. El overlay muestra el inglés arriba (más pequeño y con la etiqueta EN) y el español debajo (ES).
4. **Dos traducciones**: subtítulo 1 español, subtítulo 2 francés. El overlay muestra ES y FR, cada una con su etiqueta. El texto aparece cuando terminan las dos.
5. **No repetir idioma**: con español en el subtítulo 1, el 2 no ofrece español. No hay forma de activar un tercero.
6. **Cambio con la sesión en marcha**: cambia un idioma con una sesión iniciada; aparece el aviso y la sesión se reinicia con los idiomas nuevos. Mostrar u ocultar el original no la reinicia.
7. **Origen sin destinos**: cambia el origen a un idioma sin traducciones (p. ej. alemán solo traduce al inglés): se quitan los destinos que ya no existen, se avisa y queda el texto original.
8. **Que quepan**: en Apariencia pon fuente 96 y 6 líneas con dos subtítulos: cada uno muestra menos líneas pero los dos se ven completos dentro de la pantalla; el ajuste «6 líneas» no cambia.
9. **Fallo parcial**: con `en->fr` sin descargar y los dos destinos activos, la sesión no arranca y avisa de los modelos que faltan (los de los dos destinos).
10. **Ajustes antiguos**: copia un `settings.json` con `"to": "fr"` (sin `targets`): al abrir la app queda un destino francés y se conserva el resto.
