# Tasks

## 1. Datos de partida (solo lectura)

- [ ] 1.1 Leer `app/src/main/shortcuts.ts` y los valores por defecto de `settings-store.ts`; anotar atajos y modos reales. Verificación: lista de atajos con la línea de código de cada uno.
- [ ] 1.2 Leer `crates/tr-models/models.json` y extraer id, tamaño total y origen de cada modelo. Verificación: tabla provisional cuyos totales coinciden con la suma de `size` por modelo.
- [ ] 1.3 Comprobar la licencia de cada modelo y librería principal (PP-OCRv6, Opus-MT, Whisper, `ort`, `oar-ocr`, `xcap`) en su origen. Verificación: licencia y URL anotadas para cada uno; si alguna no se puede confirmar, queda marcada «sin verificar».
- [ ] 1.4 Leer cómo `tr-models` y `tr-engine` registran pares de idiomas y adaptadores. Verificación: pasos de la receta reproducibles sobre un par existente de `models.json`.

## 2. Archivos nuevos

- [ ] 2.1 Crear `LICENSE` (MIT, 2026, titular según `app/package.json`). Verificación: el archivo existe y su nombre de licencia coincide con `license` en `Cargo.toml`.
- [ ] 2.2 Crear `CONTRIBUTING.md` con el flujo OpenSpec (explore, propose, apply, archive), las reglas no negociables y los comandos de verificación de `CLAUDE.md`. Verificación: cada comando citado existe en `CLAUDE.md` o `app/package.json`.

## 3. Secciones de confianza en el README

- [ ] 3.1 Añadir «Por qué existe» y «Límites conocidos». Verificación: cada límite cita un ADR o una medición de `docs/perf/hito-5.md`.
- [ ] 3.2 Añadir «Privacidad verificable» con los mecanismos y la ruta de cada uno (`clippy.toml`, lints del workspace, test `no_content_leaks`). Verificación: cada ruta enlazada existe y el test `no_content_leaks` aparece al buscarlo con `cargo test --workspace -- --list`.
- [ ] 3.3 Añadir la tabla de modelos y descargas (tarea 1.2) con la fuente indicada. Verificación: los tamaños coinciden con `models.json`.
- [ ] 3.4 Añadir «Huella de recursos» con resumen, fecha y hardware, y enlace a `docs/perf/hito-5.md`. Verificación: cada cifra aparece en ese documento.

## 4. Uso y diagramas

- [ ] 4.1 Añadir «Cómo se usa» con los atajos de la tarea 1.1 y los escenarios «qué pasa cuando…» (con texto, sin texto, sin modelos, sin red). Verificación: cada escenario cubre un comportamiento de `openspec/specs/text-audio-fallback` o `model-management`.
- [ ] 4.2 Añadir el diagrama del flujo del pipeline en ASCII. Verificación: sus etapas coinciden con `openspec/specs/region-pipeline`.
- [ ] 4.3 Añadir el mapa de crates con una línea y un enlace a la spec de cada uno. Verificación: todos los enlaces resuelven a archivos existentes.

## 5. Contribuir, plataformas y ayuda

- [ ] 5.1 Añadir la receta «Añadir un idioma o un motor» según la tarea 1.4, enlazada a `CONTRIBUTING.md`. Verificación: seguir los pasos sobre un par existente reproduce su entrada en `models.json`; si no coincide, ajustar o quitar la receta.
- [ ] 5.2 Añadir «Estado por plataforma» a partir de `docs/validation/` y del CI. Verificación: cada marca de «probado» apunta a un documento o job de CI.
- [ ] 5.3 Añadir «Solución de problemas» (audio con PulseAudio/PipeWire, Wayland/WSLg, `libgbm`) tomando los datos de `CLAUDE.md` y los ADR. Verificación: cada problema cita su causa y solución en un archivo del repo.
- [ ] 5.4 Añadir «Agradecimientos» con las licencias de la tarea 1.3 y actualizar el índice del README. Verificación: todo encabezado nuevo aparece en el índice con ancla válida.

## 6. Elementos que dependen de publicar

- [ ] 6.1 Generar capturas o GIF de selector, overlay y subtítulos en `docs/media/` y referenciarlas. Verificación: las imágenes existen y se ven en la vista previa del README. Si no hay capturas, omitir la sección.
- [ ] 6.2 Añadir la insignia de CI y comprobar el enlace a Releases tras subir el repo y publicar `v0.1.0`. Verificación: la insignia muestra estado y el enlace abre la release.

## 7. Cierre

- [ ] 7.1 Revisar el README completo (enlaces relativos, anclas del índice, tablas) y ejecutar `openspec validate readme-completo`. Verificación: sin enlaces rotos y validación sin errores.
- [ ] 7.2 Commit de los cambios de documentación. Verificación: `git status` limpio salvo los archivos ajenos ya modificados.
