# Spec Delta

## Purpose

Proveer una aplicación de escritorio mínima que aloja el motor en un proceso aislado y demuestra el flujo completo JS -> Rust -> JS, sirviendo de base para las ventanas de producto.

## ADDED Requirements

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

### Requirement: Sin ventanas de producto
Este alcance MUST NOT incluir el selector de región, el overlay ni la ventana de ajustes.

#### Scenario: Alcance
- **WHEN** se ejecuta la aplicación mínima
- **THEN** no existen ventanas de producto; la verificación se hace por consola o prueba automatizada
