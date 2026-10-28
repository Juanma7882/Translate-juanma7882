# Spec Delta

## MODIFIED Requirements

### Requirement: Captura del audio del sistema
El sistema SHALL capturar el audio de una fuente elegida (por defecto, el dispositivo de salida del sistema; opcionalmente, una aplicación concreta) y entregarlo como trozos mono f32 a 16 kHz de 100 ms con instantes de inicio consecutivos.

#### Scenario: Audio reproduciéndose
- **WHEN** suena audio por los altavoces con la captura activa
- **THEN** el callback recibe trozos con ese audio

#### Scenario: Sin servidor o dispositivo de sonido
- **WHEN** no hay servidor de sonido o dispositivo de salida
- **THEN** `start` falla con un error de captura descriptivo y no queda ningún hilo

#### Scenario: Captura de una aplicación
- **WHEN** la fuente es una aplicación y suenan esa aplicación y otra
- **THEN** los trozos contienen solo el audio de la elegida

#### Scenario: Aplicación inexistente
- **WHEN** la fuente es una aplicación que no existe o no suena
- **THEN** `start` falla con un error descriptivo o queda en espera, según el caso, y no queda ningún hilo huérfano

## ADDED Requirements

### Requirement: Enumeración de fuentes
Cada plataforma SHALL poder enumerar las aplicaciones con audio activo (nombre de programa e identificador) o declarar que no puede, sin abrir ninguna captura y sin escribir audio.

#### Scenario: Plataforma sin soporte
- **WHEN** el sistema no admite capturar por aplicación
- **THEN** la enumeración indica que no está disponible y el motivo

### Requirement: Fuente que desaparece
Si la aplicación capturada termina, la captura SHALL informar de ello al motor en lugar de entregar silencio como si siguiera activa.

#### Scenario: Cierre de la aplicación
- **WHEN** la aplicación de la que se captura se cierra
- **THEN** el motor recibe el aviso de fuente perdida
