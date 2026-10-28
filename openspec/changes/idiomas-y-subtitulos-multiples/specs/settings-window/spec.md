# Spec Delta

## MODIFIED Requirements

### Requirement: Idiomas
La ventana SHALL permitir elegir el idioma de origen y los idiomas de destino con selectores independientes: uno para el idioma del contenido y otro u otros para el idioma o idiomas de la traducción. El selector de origen SHALL ofrecer los idiomas que el reconocimiento (OCR o voz) sabe leer, y el de destino SHALL ofrecer únicamente los que tienen modelo de traducción desde el origen elegido, sin incluir el propio origen. El par SHALL gestionarse en un único lugar, la pestaña Idiomas; no SHALL existir un segundo selector equivalente en General. La pestaña Inicio SHALL ofrecer además un atajo para cambiar entre pares ya instalados.

#### Scenario: Mismo idioma
- **WHEN** el usuario intenta usar el mismo idioma como origen y como destino
- **THEN** el destino no se ofrece en la lista y, si llega por otra vía, la ventana lo rechaza con un mensaje y conserva la selección anterior

#### Scenario: Un solo sitio para elegir el par
- **WHEN** el usuario abre la pestaña General
- **THEN** no hay selectores de idioma de origen y destino, y el par activo se gestiona en la pestaña Idiomas

#### Scenario: Elegir origen y destino por separado
- **WHEN** el usuario abre la pestaña Idiomas
- **THEN** ve un selector «El contenido está en…» y un selector «Traducir a…», y cambiar uno no cambia el otro salvo que el destino deje de ser posible

#### Scenario: Destinos según el origen
- **WHEN** el usuario elige francés como origen
- **THEN** el selector de destino ofrece solo los idiomas a los que existe traducción desde el francés

## ADDED Requirements

### Requirement: Elección de pistas de subtítulo
La pestaña Idiomas SHALL permitir activar la pista original y añadir o quitar hasta tres destinos de traducción, mostrando por cada destino si sus modelos están instalados y permitiendo descargarlos. SHALL impedir dejar la configuración sin ninguna pista activa y SHALL indicar el límite de tres traducciones. La opción de mostrar el original SHALL estar solo en este lugar.

#### Scenario: Añadir un segundo destino
- **WHEN** el usuario tiene español como destino y añade francés
- **THEN** la lista de pistas muestra original, español y francés, y indica si faltan modelos del francés con un botón para descargarlos

#### Scenario: Quitar el último destino
- **WHEN** el usuario quita el único destino con la pista original activa
- **THEN** queda solo la pista original y la ventana indica que se mostrará el texto sin traducir

#### Scenario: Sin ninguna pista
- **WHEN** el usuario intenta desactivar la pista original sin destinos elegidos
- **THEN** la ventana no lo permite y explica que debe haber al menos una pista

#### Scenario: Cuarto destino
- **WHEN** ya hay tres destinos elegidos
- **THEN** no se pueden añadir más y se indica el límite

#### Scenario: Cambio con una sesión en marcha
- **WHEN** hay una sesión en marcha y el usuario cambia el origen o los destinos
- **THEN** la ventana avisa de que la sesión se reiniciará con la configuración nueva
