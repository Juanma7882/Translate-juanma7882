# Spec Delta

## Purpose

Dar al usuario controles visibles para iniciar, pausar, reiniciar y detener la traducción desde la ventana principal, con el estado actual siempre a la vista.

## ADDED Requirements

### Requirement: Botones de control
La ventana principal SHALL mostrar los botones Iniciar, Pausar (o Reanudar), Reiniciar y Detener, habilitados según el estado: Iniciar solo en reposo, Pausar y Detener solo con sesión en marcha, Reiniciar con sesión en marcha o en pausa.

#### Scenario: En reposo
- **WHEN** no hay sesión
- **THEN** solo Iniciar está habilitado

#### Scenario: Traduciendo
- **WHEN** hay una sesión en marcha
- **THEN** Pausar, Reiniciar y Detener están habilitados e Iniciar no

#### Scenario: En pausa
- **WHEN** la sesión está en pausa
- **THEN** el botón de pausa pasa a ser Reanudar

### Requirement: Reiniciar
Reiniciar SHALL detener la sesión y empezar otra con el modo, la región, los idiomas y la fuente de audio actuales, y MUST ser seguro si se pulsa varias veces seguidas.

#### Scenario: Pulsar varias veces
- **WHEN** el usuario pulsa Reiniciar tres veces seguidas
- **THEN** queda una única sesión en marcha y no hay capturas duplicadas

### Requirement: Estado visible
La ventana principal SHALL mostrar el estado (en reposo, iniciando, traduciendo, en pausa o error), el modo activo y la fuente de audio, y MUST anunciarlos a lectores de pantalla cuando cambien.

#### Scenario: Cambio de estado
- **WHEN** la sesión pasa de reposo a traduciendo
- **THEN** el estado visible y el anuncio accesible se actualizan sin recargar la ventana

### Requirement: Iniciar sin modelos
Si faltan modelos para el modo elegido, Iniciar SHALL mostrar qué falta y llevar a la descarga de idiomas en lugar de fallar en silencio.

#### Scenario: Primer uso
- **WHEN** el usuario pulsa Iniciar y no hay modelos descargados
- **THEN** se explica qué falta con su tamaño y se ofrece descargarlo

### Requirement: Interfaz sin bloqueo
Las acciones de los botones SHALL ejecutarse sin bloquear la interfaz y mostrar el estado "iniciando" mientras el motor responde.

#### Scenario: Arranque lento
- **WHEN** el motor tarda segundos en abrir los modelos
- **THEN** la ventana sigue respondiendo y muestra "iniciando"
