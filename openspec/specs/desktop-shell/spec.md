# desktop-shell Specification

## Purpose

Proveer una aplicación de escritorio mínima que aloja el motor en un proceso aislado y demuestra el flujo completo JS -> Rust -> JS, sirviendo de base para las ventanas de producto.

## Requirements

### Requirement: Motor en proceso aislado
La aplicación SHALL ejecutar el motor nativo en un proceso separado del proceso principal.

#### Scenario: Arranque
- **WHEN** la aplicación inicia
- **THEN** el motor se carga en el proceso aislado y el proceso principal permanece responsivo

### Requirement: Recuperación de caídas
Si el proceso del motor termina inesperadamente, la aplicación SHALL detectarlo, notificar el error y poder reiniciarlo.

#### Scenario: Caída del motor
- **WHEN** el proceso del motor termina de forma inesperada
- **THEN** se registra el fallo (sin contenido), se notifica y el motor puede reiniciarse sin cerrar la aplicación

### Requirement: Flujo de extremo a extremo
La aplicación SHALL permitir, con motores falsos, iniciar una traducción de región y observar eventos de traducción en el proceso principal.

#### Scenario: Prueba de humo
- **WHEN** se inicia una traducción con motores falsos
- **THEN** el proceso principal recibe al menos un evento de traducción generado por el núcleo

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
