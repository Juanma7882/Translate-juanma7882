# Spec Delta

## ADDED Requirements

### Requirement: Ventanas de producto
La aplicación SHALL ofrecer las ventanas de producto (selector de región, overlay y ajustes), cada una aislada del sistema de archivos y de Node, comunicándose con el proceso principal solo mediante una interfaz mínima y tipada.

#### Scenario: Aislamiento de las ventanas
- **WHEN** se abre cualquier ventana de producto
- **THEN** su código de interfaz no tiene acceso directo a Node ni al sistema de archivos y solo usa la interfaz expuesta por el proceso principal

### Requirement: Flujo con motores reales
La aplicación SHALL poder, con motores reales y modelos listos, capturar una región, reconocer y traducir su texto y mostrarlo en el overlay.

#### Scenario: Región con texto conocido
- **WHEN** se traduce una región que muestra un texto conocido
- **THEN** el proceso principal recibe una traducción de ese texto y el overlay la muestra

## REMOVED Requirements

### Requirement: Sin ventanas de producto
**Reason**: el Hito 2 incorpora las ventanas de producto (selector de región, overlay y ajustes), por lo que la restricción del shell mínimo deja de aplicar.
**Migration**: la verificación pasa a hacerse sobre las ventanas reales y el flujo completo descritos en los requisitos "Ventanas de producto" y "Flujo con motores reales".
