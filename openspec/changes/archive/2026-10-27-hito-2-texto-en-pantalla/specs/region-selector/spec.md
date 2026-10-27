# Spec Delta

## Purpose

Permitir al usuario elegir con el mouse la región de la pantalla donde aparece el texto a traducir, y recordarla para la próxima vez.

## ADDED Requirements

### Requirement: Selección con arrastre
El sistema SHALL mostrar una ventana transparente a pantalla completa sobre el monitor elegido en la que el usuario arrastra un rectángulo, y SHALL devolver la región en píxeles físicos y el monitor al confirmarla.

#### Scenario: Selección confirmada
- **WHEN** el usuario arrastra un rectángulo y suelta el mouse
- **THEN** la ventana se cierra y la región elegida queda disponible con sus coordenadas físicas y su monitor

#### Scenario: Cancelación
- **WHEN** el usuario pulsa Escape
- **THEN** la ventana se cierra y no se cambia la región

### Requirement: Escala de pantalla
La conversión entre las coordenadas de la interfaz y los píxeles físicos SHALL ser correcta para cualquier factor de escala y para monitores con origen negativo.

#### Scenario: Pantalla con escala 150 %
- **WHEN** el usuario selecciona una región en un monitor con escala 150 %
- **THEN** la región entregada está en píxeles físicos y cubre exactamente lo seleccionado

### Requirement: Región mínima
El sistema SHALL ignorar selecciones demasiado pequeñas para contener texto.

#### Scenario: Clic sin arrastre
- **WHEN** el usuario hace clic sin arrastrar
- **THEN** no se confirma ninguna región y la ventana sigue abierta

### Requirement: Recordar la última región
El sistema SHALL recordar la última región confirmada entre sesiones y SHALL mostrarla como punto de partida al volver a seleccionar.

#### Scenario: Reinicio de la aplicación
- **WHEN** la aplicación se reinicia después de haber elegido una región
- **THEN** la última región está disponible para reutilizarla sin volver a elegirla

### Requirement: Sin captura de pantalla de fondo
El selector MUST NOT capturar ni guardar la imagen de la pantalla; solo dibuja el rectángulo sobre un fondo transparente.

#### Scenario: Selección
- **WHEN** el usuario elige una región
- **THEN** no se captura ninguna imagen de la pantalla para mostrar el selector
