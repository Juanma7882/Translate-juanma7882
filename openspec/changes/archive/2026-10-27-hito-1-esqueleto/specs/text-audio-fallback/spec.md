# Spec Delta

## Purpose

Alternar automáticamente entre traducir texto en pantalla y subtitular audio, según haya o no texto en la región, sin parpadeos entre modos.

## ADDED Requirements

### Requirement: Modo texto por defecto
Al iniciar con una región, el sistema SHALL operar en modo texto.

#### Scenario: Inicio con región
- **WHEN** se inicia con una región seleccionada
- **THEN** el modo activo es texto y la captura de audio no está activa

### Requirement: Paso a audio por ausencia de texto
El sistema SHALL pasar a modo audio cuando el reconocimiento no encuentre texto durante un tiempo configurable consecutivo.

#### Scenario: Región sin texto
- **WHEN** transcurre el tiempo configurado sin que el OCR encuentre texto
- **THEN** el sistema activa la captura de audio y emite un evento de cambio de modo

### Requirement: Regreso a texto
Mientras esté en modo audio, el sistema SHALL seguir vigilando la región y volver a modo texto cuando se encuentre texto de nuevo.

#### Scenario: Reaparece texto
- **WHEN** el OCR encuentra texto durante el modo audio
- **THEN** el sistema detiene la captura de audio y vuelve a modo texto

### Requirement: Histéresis
El sistema MUST NOT cambiar de modo por ausencias o apariciones de texto más cortas que los umbrales configurados.

#### Scenario: Texto intermitente
- **WHEN** el texto desaparece por menos del umbral y reaparece
- **THEN** el modo no cambia

### Requirement: Pausa
El sistema SHALL permitir pausar y reanudar; en pausa no se captura pantalla ni audio ni se emiten eventos de traducción.

#### Scenario: Pausar
- **WHEN** se pausa el sistema
- **THEN** se detienen ambas capturas y se reanudan en el modo previo al reanudar
