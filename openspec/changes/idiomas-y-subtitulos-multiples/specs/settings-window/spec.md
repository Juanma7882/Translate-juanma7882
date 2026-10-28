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

### Requirement: Elección de subtítulos
La pestaña Idiomas SHALL presentar dos subtítulos: «Subtítulo 1», siempre activo, y «Subtítulo 2», opcional, que el usuario puede activar y desactivar. Cada uno SHALL permitir elegir su idioma entre el idioma de origen (el texto original, sin traducir) y los destinos disponibles desde ese origen, sin permitir el mismo idioma en los dos. Por cada idioma traducido SHALL mostrar si sus modelos están instalados y permitir descargarlos. SHALL indicar que se muestran como máximo dos subtítulos, y SHALL informar de que el original se muestra siempre arriba y la traducción debajo.

#### Scenario: Activar el segundo subtítulo
- **WHEN** el usuario tiene el original como subtítulo 1 y activa el subtítulo 2 eligiendo francés
- **THEN** la lista muestra original y francés, e indica si faltan modelos del francés con un botón para descargarlos

#### Scenario: Desactivar el segundo subtítulo
- **WHEN** el usuario desactiva el subtítulo 2
- **THEN** queda un solo subtítulo y la ventana lo indica

#### Scenario: Mismo idioma en los dos
- **WHEN** el subtítulo 1 está en español
- **THEN** el subtítulo 2 no ofrece el español

#### Scenario: Un solo subtítulo traducido
- **WHEN** el usuario elige español como subtítulo 1 y no activa el 2
- **THEN** se muestra solo la traducción al español y no se exige el modelo del original más allá del reconocimiento

#### Scenario: Máximo de dos
- **WHEN** ya hay dos subtítulos activos
- **THEN** no se ofrece activar un tercero y se indica el límite de dos

#### Scenario: Cambio con una sesión en marcha
- **WHEN** hay una sesión en marcha y el usuario cambia el origen o un idioma traducido
- **THEN** la ventana avisa de que la sesión se reiniciará con la configuración nueva
