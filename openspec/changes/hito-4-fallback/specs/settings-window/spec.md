# Spec Delta

## ADDED Requirements

### Requirement: Modo y fallback
La ventana de Ajustes SHALL permitir elegir el modo (automático, solo texto, solo audio), el tiempo sin texto antes de pasar a audio (segundos) y el atajo para alternar el modo, validando los valores y guardándolos al instante. Cuando el modo requiera modelos de audio que falten SHALL indicarlo.

#### Scenario: Cambiar el modo
- **WHEN** el usuario elige "Solo audio"
- **THEN** el ajuste se guarda y la ventana lo muestra seleccionado

#### Scenario: Tiempo inválido
- **WHEN** el usuario escribe 0 o 100 segundos
- **THEN** se explica el rango permitido y no se guarda
