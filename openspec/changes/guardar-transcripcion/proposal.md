# Proposal

## Why

Hoy todo lo que se transcribe y traduce vive solo en RAM y se pierde al cerrar la sesión: no hay forma de repasar una clase, una reunión o un vídeo después. Algunos usuarios quieren conservar ese texto, pero la regla nº 1 del proyecto («nunca escribir texto ni traducciones a disco») lo impide; hace falta una excepción explícita, opcional y desactivada por defecto, que no debilite la garantía para quien no la active.

## What Changes

- Nuevo interruptor «Guardar transcripción» (desactivado por defecto) y una carpeta de destino elegida por el usuario con un diálogo; sin carpeta válida no se puede activar.
- Con el interruptor activo, cada línea **final** (nunca parciales) se añade **en el momento** a los archivos de la sesión: un `.txt` legible siempre y, opcionalmente (activado por defecto), un `.srt`.
- Se guardan tanto las líneas del audio (reconocimiento de voz) como las del texto en pantalla (OCR), con hora relativa al inicio de la sesión, el texto original y cada traducción activa.
- Un par de archivos nuevo por sesión (nombre con fecha y hora de inicio); pausar/reanudar sigue en los mismos archivos.
- Se puede activar o desactivar también durante una sesión (bandeja y Ajustes); el overlay y la bandeja muestran un indicador mientras se guarda.
- Si la escritura falla (carpeta borrada, disco lleno, sin permisos) se avisa, se deja de guardar en esa sesión y la traducción sigue.
- Las preferencias de transcripción no se exportan ni se importan, y «Restablecer» la desactiva (conserva la carpeta).
- **Enmienda de la regla nº 1**: nuevo ADR que la redefine como «nada se escribe a disco salvo modelos, config y, si el usuario lo activa explícitamente, la transcripción en la carpeta que eligió». Se actualizan `CLAUDE.md`, el README y los comentarios que afirman que los ajustes son la única escritura desde JS.

## Capabilities

### New Capabilities
- `transcript-saving`: guardado opcional de la transcripción (activación, carpeta, contenido y formatos `.txt`/`.srt`, escritura continua por sesión, indicador, errores y privacidad).

### Modified Capabilities
<!-- Ninguna: los controles de Ajustes y de bandeja se especifican en transcript-saving; la exportación de ajustes ya excluye rutas de carpetas y contenido, y la transcripción se excluye por completo. -->

## Impact

- **Código (app, proceso principal)**: nuevo escritor de transcripción que escucha los eventos `translation`/`subtitle` que ya recibe `AppController`; ajustes nuevos en `shared/settings.ts` (validación, valores por defecto, reset, exclusión del export); IPC de Ajustes (elegir carpeta, validar); pestaña General de Ajustes (Preact); menú de bandeja; indicador en el overlay; avisos.
- **Núcleo Rust**: sin cambios. Las garantías de `no_content_leaks` y los lints siguen intactos; el contenido solo se escribe desde el proceso principal y solo con el interruptor activo.
- **Documentación**: `docs/adr/0011-guardar-transcripcion.md`, regla 1 en `CLAUDE.md`, sección de privacidad del README, `docs/validation/` (lista manual en Windows).
- **Sin dependencias nuevas** (solo `node:fs`).
