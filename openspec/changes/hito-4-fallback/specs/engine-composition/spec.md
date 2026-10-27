# Spec Delta

## ADDED Requirements

### Requirement: Fallback real con un solo traductor
Con motores reales y fallback activo, texto y audio SHALL compartir una única instancia del traductor del par.

#### Scenario: Una carga
- **WHEN** se arranca una región con fallback real
- **THEN** el modelo de traducción se carga una sola vez

### Requirement: Modelos faltantes del fallback agregados
Si faltan modelos al arrancar con fallback real, el error SHALL listar los de texto y los de audio juntos, sin duplicados.

#### Scenario: Faltan ambos ámbitos
- **WHEN** no hay ningún modelo descargado
- **THEN** el error nombra OCR, voz y traducción en un único mensaje
