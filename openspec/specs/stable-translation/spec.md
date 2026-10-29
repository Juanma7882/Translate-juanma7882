# stable-translation Specification

## Purpose
Permitir que, en modo texto, la traducción mostrada se mantenga mientras el texto de la región no cambie, sin desaparecer por tiempo ni regenerarse al pausar y reanudar.

## Requirements

### Requirement: Ajuste para mantener la traducción
El usuario SHALL poder activar el ajuste "Mantener la traducción mientras el texto no cambie" en Ajustes > Overlay. El ajuste SHALL estar desactivado por defecto, SHALL guardarse con el resto de los ajustes y su cambio SHALL aplicarse sin reiniciar la sesión.

#### Scenario: Valor por defecto
- **WHEN** el usuario abre los ajustes por primera vez o desde una configuración anterior que no tenía el ajuste
- **THEN** el ajuste aparece desactivado y el comportamiento es el de siempre

#### Scenario: Activarlo con la sesión en marcha
- **WHEN** el usuario activa el ajuste con una sesión de texto en marcha
- **THEN** la sesión no se reinicia, la regla de no ocultar por tiempo se aplica desde la próxima traducción mostrada y la de reanudar sin regenerar, desde la próxima sesión

### Requirement: La traducción se mantiene mientras el texto no cambia
Con el ajuste activado y en modo texto, el overlay SHALL mantener visible la última traducción mientras el texto de la región no cambie y MUST NOT ocultarla por el tiempo "Ocultar tras". El overlay SHALL ocultarla cuando la región se quede sin texto, o reemplazarla cuando llegue otra traducción.

#### Scenario: Texto fijo en pantalla
- **WHEN** hay una traducción mostrada, el texto de la región no cambia y pasa más tiempo que el configurado en "Ocultar tras"
- **THEN** la traducción sigue visible

#### Scenario: La región se queda sin texto
- **WHEN** hay una traducción mostrada y el texto desaparece de la región
- **THEN** el overlay oculta la traducción

#### Scenario: El texto cambia
- **WHEN** el texto de la región cambia y llega una traducción nueva
- **THEN** el overlay reemplaza la traducción anterior por la nueva

#### Scenario: Ajuste desactivado
- **WHEN** el ajuste está desactivado y pasa el tiempo "Ocultar tras" sin traducciones nuevas
- **THEN** el overlay oculta el texto como siempre

### Requirement: Reanudar sin regenerar
Con el ajuste activado, reanudar tras una pausa SHALL NOT volver a emitir ni a mostrar una traducción cuyo texto original no cambió. Si el texto cambió durante la pausa, SHALL traducirse el texto nuevo; si desapareció, el overlay SHALL ocultar la traducción.

#### Scenario: Pausa y reanudación con la pantalla igual
- **WHEN** el usuario pausa con una traducción mostrada, la pantalla no cambia y reanuda
- **THEN** la traducción permanece visible sin parpadeo y no se emite ninguna traducción nueva

#### Scenario: El texto cambió durante la pausa
- **WHEN** el texto de la región cambia mientras la sesión está en pausa y el usuario reanuda
- **THEN** se traduce el texto nuevo y reemplaza al anterior

#### Scenario: El texto desapareció durante la pausa
- **WHEN** el texto de la región desaparece mientras la sesión está en pausa y el usuario reanuda
- **THEN** el overlay oculta la traducción

### Requirement: Aviso de región sin texto sin contenido
El motor SHALL avisar con un evento cuando la región pase de tener texto traducido a no tener texto, una sola vez por cada paso, y el evento MUST NOT contener texto capturado ni traducido.

#### Scenario: El texto desaparece
- **WHEN** la región tenía un texto ya traducido y el OCR deja de encontrar texto
- **THEN** se emite un único evento de región sin texto, sin contenido

#### Scenario: Región que sigue vacía
- **WHEN** la región sigue sin texto en los frames siguientes
- **THEN** no se emiten más eventos de región sin texto

### Requirement: El audio conserva el ocultado por tiempo
El ajuste SHALL NOT afectar a los subtítulos de audio: en modo audio el overlay SHALL seguir ocultando el texto por el tiempo "Ocultar tras".

#### Scenario: Audio con el ajuste activado
- **WHEN** el ajuste está activado, el modo es audio y pasa el tiempo "Ocultar tras" sin subtítulos nuevos
- **THEN** el overlay oculta el subtítulo
