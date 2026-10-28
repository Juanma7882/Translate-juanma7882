# translation-overlay Specification

## Purpose
Mostrar el texto original y su traducción encima de la aplicación del usuario, sin tapar la región traducida ni interferir con el mouse o el teclado.

## Requirements

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

### Requirement: Indicador de modo
El overlay SHALL mostrar el modo activo (texto, audio o pausa) como una etiqueta discreta, visible mientras hay texto y durante unos segundos tras cada cambio de modo. Al cambiar de modo el texto anterior SHALL borrarse.

#### Scenario: Paso a audio
- **WHEN** el modo activo pasa de texto a audio
- **THEN** la etiqueta muestra "Audio" y el último texto traducido ya no se ve

#### Scenario: Sin contenido persistente
- **WHEN** cambia el modo
- **THEN** la etiqueta solo contiene el nombre del modo, nunca texto capturado

### Requirement: Colores del overlay
El overlay SHALL aplicar el color de texto y el de fondo configurados, y la configuración MUST garantizar un contraste de al menos 4,5:1 entre ambos.

#### Scenario: Colores personalizados
- **WHEN** el usuario elige texto amarillo sobre fondo negro
- **THEN** el overlay se muestra con esos colores

### Requirement: Límite de líneas
El overlay SHALL limitar la traducción visible al número de líneas configurado (1 a 6) y ajustar la altura de la ventana.

#### Scenario: Una sola línea
- **WHEN** el límite es 1 y la traducción ocupa tres líneas
- **THEN** se muestra una línea truncada con puntos suspensivos

### Requirement: Posición manual arrastrable
El overlay SHALL poder colocarse manualmente arrastrándolo en un modo de movimiento temporal, guardando la posición, y SHALL volver a ser atravesable por el ratón y sin foco al terminar.

#### Scenario: Mover el overlay
- **WHEN** el usuario activa "Mover overlay" y arrastra el asa
- **THEN** la posición se guarda como manual y el overlay vuelve a ignorar el ratón al terminar
