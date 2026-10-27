# Spec Delta

## ADDED Requirements

### Requirement: Motores reales de audio
Con el conjunto real, `start_audio` y el fallback a audio SHALL usar captura del sistema, reconocimiento de voz y traducción reales, comprobando antes que los modelos estén listos.

#### Scenario: Modelos de audio faltantes
- **WHEN** se inicia audio real y faltan modelos
- **THEN** falla con un error que lista solo los modelos de voz y traducción ausentes, sin abrir la captura

#### Scenario: Idioma no soportado
- **WHEN** el idioma de origen no tiene modelo de voz o el par no tiene traducción
- **THEN** falla como argumento inválido antes de mirar la carpeta de modelos

#### Scenario: Motor no compilado
- **WHEN** el build no incluye la captura o el STT
- **THEN** el error nombra el motor ausente
