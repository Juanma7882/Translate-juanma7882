# Spec Delta

## ADDED Requirements

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
