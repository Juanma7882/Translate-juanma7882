# Spec Delta

## Purpose

Capturar en memoria una región de la pantalla real para alimentar el OCR, con coordenadas en píxeles físicos y errores claros cuando el sistema no permite capturar.

## ADDED Requirements

### Requirement: Captura de región en memoria
El sistema SHALL capturar la región pedida de la pantalla real y entregarla como imagen en memoria con las dimensiones de la región, sin escribirla a disco.

#### Scenario: Región visible
- **WHEN** se pide capturar una región que está dentro de un monitor
- **THEN** se obtiene una imagen cuyo tamaño coincide con la región y cuyo contenido corresponde a lo mostrado en pantalla

### Requirement: Selección de monitor y coordenadas físicas
El sistema SHALL interpretar la región en píxeles físicos y, junto con el identificador de monitor, ubicarla en el monitor correcto, incluidos monitores con origen negativo.

#### Scenario: Segundo monitor
- **WHEN** se pide una región del monitor 1 con coordenadas relativas a ese monitor
- **THEN** la captura corresponde al monitor 1 y no al principal

#### Scenario: Región fuera del monitor
- **WHEN** la región excede los límites del monitor
- **THEN** el sistema informa un error de captura o recorta la región a los límites, sin fallar de forma silenciosa

### Requirement: Errores de captura descriptivos
El sistema SHALL informar como error de captura, con un mensaje accionable, los casos en que no se puede capturar: monitor inexistente, falta de permisos y entornos no soportados (por ejemplo Wayland sin portal).

#### Scenario: Monitor inexistente
- **WHEN** se pide una región de un monitor que no existe
- **THEN** se informa un error de captura que lo indica

#### Scenario: Entorno no soportado
- **WHEN** el entorno gráfico no permite capturar
- **THEN** el error de captura explica la causa y qué hacer, y el sistema no se cierra

### Requirement: Contenido protegido
Si el sistema operativo entrega una captura vacía por contenido protegido, el sistema SHALL tratarla como una captura normal sin texto y MUST NOT fallar.

#### Scenario: Captura en negro
- **WHEN** la captura sale completamente negra
- **THEN** el pipeline la procesa como un frame sin texto
