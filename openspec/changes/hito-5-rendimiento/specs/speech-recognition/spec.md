## ADDED Requirements

### Requirement: Recursos configurables
El reconocimiento de voz SHALL permitir configurar los hilos de cálculo, SHALL devolver al sistema la memoria de trabajo entre ejecuciones y SHALL cargar sus modelos en paralelo.

#### Scenario: Hilos explícitos
- **WHEN** se configuran 2 hilos
- **THEN** la transcripción usa 2 hilos y devuelve el mismo texto
