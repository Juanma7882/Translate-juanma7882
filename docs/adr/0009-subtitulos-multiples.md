# ADR 0009 — Idiomas separados y hasta dos subtítulos

- Estado: aceptado
- Cambio OpenSpec: `idiomas-y-subtitulos-multiples`
- Mediciones: `docs/perf/subtitulos-multiples.md`

## Contexto

La app traducía de un idioma a otro, elegidos como un par cerrado. El usuario pidió elegir el idioma del contenido y el de la traducción por separado y ver uno o dos subtítulos a la vez, en idiomas distintos (por ejemplo, solo inglés; inglés y español; español y francés), sin que el texto tarde en mostrarse.

## Decisiones

1. **Ajustes**: `Settings.to` pasa a `targets` (0 a 2 idiomas distintos entre sí y del origen). El subtítulo original sigue siendo `overlay.showOriginal` (no hay dos fuentes de verdad). Invariante: `1 <= (showOriginal ? 1 : 0) + targets.length <= 2`. Los ajustes guardados con `to` se leen como un destino, sin subir `SETTINGS_VERSION` (una versión desconocida restablecería todos los ajustes).
2. **Evento del núcleo**: `Event::Translation` y `Event::Subtitle` llevan `translations: Vec<Translated { lang, text }>` en el orden de los destinos, vacía sin destinos, en parciales o si fallaron todas. Un solo evento por frase.
3. **Un traductor por destino** (`Target { lang, translator }`), compartidos entre texto y audio en el fallback. Con cero destinos no se carga ni se exige ningún modelo de traducción: solo OCR o voz.
4. **Traducción en paralelo** con `std::thread::scope` (sin pool ni `tokio`, como el resto del núcleo): con dos destinos, cada frase se traduce a la vez y el resultado conserva el orden de los destinos. Un fallo o pánico de un destino no pierde el otro. No se reparten los hilos de ONNX: el traductor ya limita su valor automático a 2.
5. **Fallos parciales**: se informa el error del destino que falló y se muestra el otro. Solo si fallan todos se reintenta la frase.
6. **Interfaz**: dos casillas, «Subtítulo 1» (siempre) y «Subtítulo 2» (opcional), cada una con su idioma (el de origen significa el texto original) y sin repetir idioma. El original se muestra siempre arriba; por eso la interfaz lo normaliza como subtítulo 1 si queda en el 2.
7. **Overlay**: un párrafo por subtítulo, con etiqueta de idioma cuando hay dos. El límite de líneas es por subtítulo y baja solo (`linesPerTrack`, mínimo una) para que ambos quepan en el 45 % del alto útil de la pantalla; el ajuste guardado no cambia. La etiqueta de modo pasa a bloque para no ocupar una línea entera del tamaño de la fuente.

## Resultado de la medición (decisión 4)

En el equipo de pruebas (Ryzen 5 4500) dos traducciones a la vez tardan lo mismo que dos seguidas (1087 ms frente a 1118 ms de media): el decodificador está limitado por el ancho de banda de memoria, no por los núcleos (dos procesos independientes también se frenan el doble; un bucle de CPU puro escala). Se mantiene el paralelo (no empeora y ganará con más ancho de banda); mostrar por etapas es la mejora pendiente si hace falta. Detalle en `docs/perf/subtitulos-multiples.md`.

## Consecuencias

- La API de JS cambia (`to: string[]`, `translations` en los eventos); el único consumidor es la app.
- Cada destino extra suma ~110 MB de modelo y ~330-450 MiB de RAM pico medidos con dos destinos.
- La GPU queda anotada como mejora futura solo si la CPU no alcanza el presupuesto.
