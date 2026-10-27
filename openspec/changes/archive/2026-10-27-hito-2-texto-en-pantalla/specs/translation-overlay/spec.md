# Spec Delta

## Purpose

Mostrar el texto original y su traducción encima de la aplicación del usuario, sin tapar la región traducida ni interferir con el mouse o el teclado.

## ADDED Requirements

### Requirement: Original y traducción visibles
El overlay SHALL mostrar a la vez el texto original y su traducción y SHALL actualizarlos cuando llega una nueva traducción.

#### Scenario: Nueva traducción
- **WHEN** llega un evento de traducción
- **THEN** el overlay muestra el original y la traducción de ese evento

#### Scenario: Sin texto
- **WHEN** pasa un tiempo configurable sin traducciones nuevas
- **THEN** el overlay oculta el texto

### Requirement: Transparente, encima y sin estorbar
El overlay SHALL ser transparente, permanecer encima de las demás ventanas, no aceptar foco y dejar pasar los clics y el teclado a la aplicación que tiene debajo.

#### Scenario: Clic sobre el overlay
- **WHEN** el usuario hace clic sobre la zona del overlay
- **THEN** el clic llega a la aplicación que está debajo

### Requirement: No leerse a sí mismo
El overlay SHALL ubicarse por defecto fuera de la región traducida y, donde el sistema lo permite, SHALL excluirse de las capturas de pantalla, para que el OCR no lea su propio texto.

#### Scenario: Posición por defecto
- **WHEN** se muestra el overlay por primera vez para una región
- **THEN** su ventana no se superpone con la región traducida

#### Scenario: Sistema sin exclusión de captura
- **WHEN** el sistema no permite excluir ventanas de la captura
- **THEN** el overlay mantiene su posición fuera de la región y la interfaz lo advierte si el usuario la superpone

### Requirement: Apariencia configurable
El usuario SHALL poder configurar posición, tamaño, opacidad y fuente del overlay, y los cambios SHALL verse sin reiniciar.

#### Scenario: Cambiar la opacidad
- **WHEN** el usuario cambia la opacidad en los ajustes
- **THEN** el overlay refleja el nuevo valor de inmediato

### Requirement: Subtítulos de audio
El overlay SHALL poder mostrar subtítulos de audio con el mismo estilo, diferenciando visualmente los parciales de los finales.

#### Scenario: Subtítulo parcial
- **WHEN** llega un subtítulo parcial
- **THEN** se muestra con estilo de provisional y lo reemplaza el final siguiente

### Requirement: Contenido solo en pantalla
El overlay MUST NOT guardar el texto mostrado en disco ni en registros.

#### Scenario: Sesión de uso
- **WHEN** el overlay muestra traducciones durante una sesión
- **THEN** no se escribe ningún texto mostrado a disco ni a registros
