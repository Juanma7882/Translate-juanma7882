# performance-budget Specification

## Purpose
TBD - created by archiving change hito-5-rendimiento. Update Purpose after archive.

## Requirements

### Requirement: Presupuestos medidos
El proyecto SHALL mantener presupuestos de latencia de texto (frame a traducción), latencia de audio (ventana a subtítulo), RAM pico y CPU en reposo, con los valores medidos y el entorno en `docs/perf/hito-5.md`.

#### Scenario: Presupuesto documentado
- **WHEN** se consulta `docs/perf/hito-5.md`
- **THEN** cada presupuesto tiene su valor medido, su umbral y el comando que lo reproduce

### Requirement: Mediciones sin contenido
Las herramientas de medición SHALL imprimir únicamente números y MUST NOT escribir capturas, audio, texto ni traducciones a disco ni a registros.

#### Scenario: Salida de una medición
- **WHEN** se ejecuta una medición de rendimiento
- **THEN** la salida contiene solo tiempos, tamaños y puntuaciones
