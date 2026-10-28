# Spec Delta

## Purpose

Permitir elegir qué audio se traduce: el de todo el sistema o el de una aplicación concreta, con una lista actualizada de las aplicaciones que están sonando.

## ADDED Requirements

### Requirement: Lista de aplicaciones con audio
El sistema SHALL ofrecer la lista de aplicaciones que reproducen audio en ese momento, con un identificador estable para la sesión y un nombre legible, y mantenerla actualizada mientras la ventana está abierta.

#### Scenario: Aplicación que empieza a sonar
- **WHEN** una aplicación empieza a reproducir audio con la ventana abierta
- **THEN** aparece en la lista en pocos segundos

#### Scenario: Aplicación que termina
- **WHEN** una aplicación deja de reproducir y se cierra
- **THEN** desaparece de la lista salvo que sea la fuente elegida

### Requirement: Elección de la fuente
El usuario SHALL poder elegir como fuente "Todo el sistema" o una aplicación de la lista. La elección MUST aplicarse al siguiente inicio o reinicio y, con una sesión en marcha, reiniciarla con la fuente nueva.

#### Scenario: Solo una aplicación
- **WHEN** el usuario elige una aplicación y suenan esa aplicación y otra
- **THEN** solo se transcribe y traduce el audio de la elegida

#### Scenario: Cambio con sesión en marcha
- **WHEN** el usuario cambia la fuente mientras traduce
- **THEN** la captura se reinicia con la fuente nueva sin cerrar la aplicación

### Requirement: Recordar la fuente
La aplicación SHALL guardar la aplicación elegida por su nombre de programa (no por el identificador de proceso) y volver a asociarla cuando vuelva a sonar.

#### Scenario: Aplicación reiniciada
- **WHEN** la aplicación elegida se cierra y se vuelve a abrir
- **THEN** la captura la retoma al empezar a sonar, sin que el usuario la elija de nuevo

### Requirement: Fuente no disponible
Si la fuente elegida no existe, desaparece o la plataforma no permite capturar por aplicación, el sistema SHALL avisar con un mensaje descriptivo y seguir ofreciendo "Todo el sistema", sin cerrar la aplicación ni dejar hilos de captura.

#### Scenario: Plataforma sin captura por aplicación
- **WHEN** el sistema operativo no admite capturar por aplicación
- **THEN** la lista indica que solo está disponible "Todo el sistema" y explica el motivo

#### Scenario: Aplicación cerrada durante la sesión
- **WHEN** la aplicación elegida se cierra con la sesión en marcha
- **THEN** la sesión queda en espera de esa aplicación, con un aviso, y se reanuda cuando vuelva a sonar

### Requirement: Solo metadatos de proceso
La lista de aplicaciones SHALL contener únicamente nombre de programa e identificador; el audio MUST NOT salir del motor y no se escribe a disco.

#### Scenario: Revisión de lo que cruza el puente
- **WHEN** se inspecciona lo que el motor entrega a la interfaz
- **THEN** solo hay nombres, identificadores, niveles y texto
