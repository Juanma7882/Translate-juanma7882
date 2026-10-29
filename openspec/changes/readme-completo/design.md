# Design

## Context

El README tiene hoy: características, motores, arquitectura, instalación, desarrollo, pruebas, empaquetado, estructura, hoja de ruta y contribuir. Los datos que faltan ya existen en el repo: tamaños y hashes en `crates/tr-models/models.json`, mediciones en `docs/perf/hito-5.md`, decisiones en `docs/adr/`, contratos en `openspec/specs/` (20 capacidades) y reglas de privacidad en `clippy.toml` y los lints del workspace. Ver proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Que cada afirmación del README (privacidad, tamaños, atajos, receta) se pueda comprobar en un archivo del repo.
- Que los datos que cambian no caduquen en silencio.
- Que el README siga siendo legible: resumen en el README, detalle enlazado.

**Non-Goals:**
- Traducir el README al inglés (decisión diferida).
- Cambiar código, CI o specs.
- Publicar la release o subir el repo.

## Decisions

1. **Resumen en el README, detalle por enlace.** Rendimiento, ADR y listas de validación quedan en `docs/`; el README muestra 3-4 cifras con fecha y hardware. Alternativa descartada: pegar la tabla completa de `hito-5.md`; envejece con cada hito.
2. **Tabla de modelos derivada del manifiesto, no escrita a mano.** Se genera una vez leyendo `models.json` y se indica en el README que la fuente es ese archivo. Alternativa: script que regenere el README en CI; es más robusto pero excede el alcance (se anota como trabajo futuro).
3. **Privacidad como lista de mecanismos comprobables**, cada uno con la ruta del archivo que lo implementa. Se evita decir «seguro» sin enlace.
4. **Receta de idioma/motor solo si se valida.** Antes de escribirla se lee cómo `tr-models` y `tr-engine` registran pares y adaptadores. Si el flujo real no coincide con «solo manifiesto», se documenta lo que sí ocurre, o se omite.
5. **Atajos leídos del código** (`shortcuts.ts` y valores por defecto de ajustes), nunca de memoria.
6. **`LICENSE` y `CONTRIBUTING.md` como archivos aparte**, enlazados desde el README. `LICENSE` con texto MIT estándar y titular tomado del autor en `app/package.json`; el año, 2026.
7. **Capturas en `docs/media/`**, referenciadas con ruta relativa. Las genera el usuario con la app corriendo o se obtienen del smoke E2E si permite captura; si no hay capturas, la sección se deja fuera en lugar de poner imágenes rotas.
8. **Orden del README** pensado por lector: qué es y por qué → instalar y usar → confianza (privacidad, modelos, recursos, límites) → contribuir.

## Risks / Trade-offs

- [Cifras de rendimiento obsoletas] → fecha y hardware junto a cada número y enlace a la fuente.
- [Receta de contribución incorrecta] → validar contra el código y, si hay duda, no afirmar.
- [Atajos o ajustes por defecto desactualizados] → leerlos del código en el momento de escribir.
- [Enlaces rotos hasta publicar repo y release] → agrupar esos enlaces (Releases, insignia CI) en una tarea final y marcarla dependiente de la publicación.
- [Los modelos tienen licencias propias] → listar la licencia de cada uno en Agradecimientos tras comprobarla en su origen, sin suponerla.
- [README largo] → índice ya existente y secciones cortas con enlaces.
