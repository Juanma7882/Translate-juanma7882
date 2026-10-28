# Spec Delta

## ADDED Requirements

### Requirement: Pares de idiomas adicionales
El manifiesto SHALL incluir pares de traducción adicionales basados en modelos Opus-MT cuantizados con URL fijada por commit, tamaño y SHA-256 medidos, y cada par SHALL traducir una frase real con el motor existente sin cambios en el núcleo.

#### Scenario: Catálogo ampliado
- **WHEN** se consulta el catálogo
- **THEN** incluye, además de en<->es, los pares en<->fr, en<->de, en<->it y es<->fr

#### Scenario: Frase real
- **WHEN** se traduce una frase de ejemplo con cada modelo nuevo
- **THEN** la salida es no vacía y distinta de la entrada
