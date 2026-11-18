# ADR 0011 — Guardar la transcripción (excepción a «todo en RAM»)

- Estado: aceptado
- Cambio OpenSpec: `guardar-transcripcion` (spec `transcript-saving`)
- Enmienda: regla nº 1 de `CLAUDE.md` y ADR 0002 («todo en RAM»)

## Contexto

Hasta ahora ningún contenido (captura, audio, texto, traducción) tocaba el disco: era la regla nº 1 y una garantía de privacidad por construcción. Los usuarios piden poder repasar después lo que se transcribió y tradujo (una clase, una reunión, un vídeo).

## Decisiones

1. **Excepción explícita y opcional.** La regla pasa a ser: nada de contenido a disco salvo la transcripción, y solo si el usuario activa «Guardar transcripción» y elige una carpeta. Desactivada por defecto. Las capturas y el audio siguen sin escribirse nunca.
2. **Escritura continua.** Cada línea final se añade en el momento a un `.txt` (y opcionalmente a un `.srt`) de la sesión. Se prefirió a «acumular en RAM y exportar al final» porque el usuario quiere no perder nada si la app se cierra.
3. **El escritor vive en el proceso principal (`TranscriptWriter`), no en Rust.** El texto ya cruza a main para el overlay; escribirlo ahí evita pasar rutas al motor (los puertos pasan buffers, no rutas) y mantiene intactas las guardas del núcleo (`no_content_leaks`, lints, `#![forbid(unsafe_code)]`).
4. **Guardas en JS.** Un test comprueba que con el interruptor apagado no se crea ningún archivo y otro que solo una lista cerrada de módulos de `app/src/main` escribe a disco.
5. **Privacidad del ajuste.** Las preferencias de transcripción no se exportan ni se importan (un archivo importado no puede activar escrituras); «Restablecer» las apaga; el overlay y la bandeja muestran un indicador mientras se guarda; los avisos de error no incluyen contenido ni la ruta completa.

## Alternativas descartadas

- **Adaptador `TranscriptSink` en Rust**: más fiel al patrón adapter, pero obliga a pasar rutas al núcleo y abrir excepciones en sus guardas por una E/S trivial.
- **Solo RAM + «Guardar transcripción…» al terminar**: excepción mínima a la regla, pero se pierde todo ante un cierre inesperado y el usuario prefirió la escritura continua.

## Consecuencias

- Con el ajuste activo, el texto queda en claro en la carpeta elegida: su protección es responsabilidad del usuario.
- Si la app se cierra de golpe, el `.txt` conserva lo escrito; el `.srt` puede perder su última entrada (se escribe con una línea de retraso para conocer su fin).
- Un fallo de escritura avisa y desactiva el guardado durante esa sesión; la traducción no se interrumpe.
