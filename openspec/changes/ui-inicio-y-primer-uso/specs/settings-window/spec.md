# Spec Delta

## MODIFIED Requirements

### Requirement: Idiomas
La ventana SHALL permitir elegir el idioma de origen y el de destino entre los que tienen modelos en el manifiesto y SHALL impedir elegir el mismo idioma en ambos. El par SHALL gestionarse en un único lugar, la pestaña Idiomas; no SHALL existir un segundo selector equivalente en General. La pestaña Inicio SHALL ofrecer además un atajo para cambiar entre pares ya instalados.

#### Scenario: Mismo idioma
- **WHEN** el usuario elige el mismo idioma de origen y de destino
- **THEN** la ventana lo rechaza con un mensaje y conserva la selección anterior

#### Scenario: Un solo sitio para elegir el par
- **WHEN** el usuario abre la pestaña General
- **THEN** no hay selectores de idioma de origen y destino, y el par activo se gestiona en la pestaña Idiomas

### Requirement: Motores
La ventana SHALL permitir elegir el conjunto de motores (reales o de demostración) y mostrar cuál está activo. La opción SHALL estar en la pestaña Avanzado, rotulada como opción de desarrollo, y no en General.

#### Scenario: Cambiar de motores
- **WHEN** el usuario cambia el conjunto de motores
- **THEN** el cambio se aplica al siguiente arranque de la traducción

#### Scenario: Ubicación
- **WHEN** el usuario abre la pestaña General
- **THEN** no aparece la elección de motores; está en Avanzado con una nota de que sirve para pruebas sin modelos

### Requirement: Apariencia del overlay
La ventana SHALL permitir configurar posición, tamaño, opacidad y fuente del overlay con una vista previa. La vista previa SHALL permanecer visible mientras se desplazan los controles de la pestaña. En la sección de posición, mover el overlay arrastrándolo SHALL ser la acción principal; las coordenadas X e Y SHALL seguir disponibles como opción secundaria plegada.

#### Scenario: Cambiar el tamaño de fuente
- **WHEN** el usuario cambia el tamaño de fuente
- **THEN** la vista previa y el overlay reflejan el cambio

#### Scenario: Vista previa a la vista
- **WHEN** el usuario se desplaza hasta los controles de colores de la pestaña Apariencia
- **THEN** la vista previa sigue visible y refleja el cambio de color

#### Scenario: Mover el overlay
- **WHEN** el usuario abre la sección de posición con la posición manual
- **THEN** el botón para mover el overlay con el ratón aparece primero y las coordenadas X e Y están en un bloque plegado que puede abrir
