# text-audio-fallback Specification

## Purpose

Alternar automáticamente entre traducir texto en pantalla y subtitular audio, según haya o no texto en la región, sin parpadeos entre modos.

## Requirements

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

### Requirement: Modo seleccionable
La aplicación SHALL permitir elegir el modo de operación: automático (texto con paso a audio), solo texto o solo audio. El modo por defecto SHALL ser automático.

#### Scenario: Solo texto
- **WHEN** el modo es solo texto
- **THEN** no se activa nunca la captura de audio aunque la región no tenga texto

#### Scenario: Solo audio
- **WHEN** el modo es solo audio
- **THEN** se subtitula el audio del sistema sin necesitar una región

### Requirement: Alternar de modo en caliente
Cambiar el modo mientras hay una sesión en marcha SHALL reiniciar la sesión en el modo nuevo sin cerrar el overlay y sin dejar capturas del modo anterior activas.

#### Scenario: Atajo de modo
- **WHEN** se pulsa el atajo de modo con una sesión en marcha
- **THEN** el modo cicla auto, texto, audio y la sesión continúa en el nuevo

### Requirement: Tiempo de espera configurable
El tiempo sin texto antes de pasar a audio SHALL ser configurable (1 a 60 s, 3 s por defecto) y aplicarse en el siguiente arranque o reinicio.

#### Scenario: Espera configurada
- **WHEN** el usuario fija 10 s y la región queda sin texto 8 s
- **THEN** el modo sigue siendo texto

### Requirement: Sin parpadeo entre modos
Con un texto que aparece y desaparece más rápido que los umbrales el sistema MUST NOT cambiar de modo, con independencia de cuánto dure la secuencia.

#### Scenario: Texto intermitente prolongado
- **WHEN** el texto alterna cada 0,5 s durante un minuto
- **THEN** no hay ningún cambio de modo
