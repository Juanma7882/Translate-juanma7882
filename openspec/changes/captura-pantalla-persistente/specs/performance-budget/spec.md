## ADDED Requirements

### Requirement: Presupuesto de captura de región
El proyecto SHALL mantener un presupuesto de latencia para la captura de una región en X11 con la conexión reutilizada, con su valor medido, su umbral y el comando que lo reproduce en `docs/perf/hito-5.md`. El valor medido SHALL ser claramente inferior a los ~187 ms por captura que tenía la captura con conexión nueva en cada llamada, y la medición MUST NOT escribir capturas a disco ni a registros.

#### Scenario: Presupuesto documentado
- **WHEN** se consulta `docs/perf/hito-5.md`
- **THEN** figura la latencia de captura antes y después, el umbral y el comando de medición

#### Scenario: Medición en otras plataformas
- **WHEN** se documentan las cifras de Windows o macOS
- **THEN** se indica el valor medido de la captura en esa plataforma, o que aún no está medido
