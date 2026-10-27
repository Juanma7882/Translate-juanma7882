# Spec Delta

## ADDED Requirements

### Requirement: Modelos de reconocimiento de voz
El manifiesto SHALL incluir modelos de voz por idioma con URL inmutable, tamaño y SHA-256 por archivo, y un manifiesto sin tabla de voz SHALL seguir siendo válido.

#### Scenario: Modelos de audio de un par
- **WHEN** se piden los modelos de audio de `en -> es`
- **THEN** son el modelo de voz del idioma de origen y la traducción del par, sin repetidos

#### Scenario: Idioma de voz sin modelo
- **WHEN** se pide un idioma sin modelo de voz
- **THEN** falla como idioma no soportado

### Requirement: Ámbitos de modelos
El estado y la descarga SHALL aceptar un ámbito `text` (por defecto), `audio` o `all`.

#### Scenario: Ámbito por defecto
- **WHEN** no se indica ámbito
- **THEN** se tratan los modelos de OCR y traducción como hasta ahora
