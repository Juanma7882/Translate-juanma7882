# settings-window Specification

## Purpose
Ofrecer una ventana donde el usuario configura idiomas, motores, apariencia del overlay y modelos, y ve el progreso de las descargas.

## Requirements

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

### Requirement: Motores
La ventana SHALL permitir elegir el conjunto de motores (reales o de demostración) y mostrar cuál está activo. La opción SHALL estar en la pestaña Avanzado, rotulada como opción de desarrollo, y no en General.

#### Scenario: Cambiar de motores
- **WHEN** el usuario cambia el conjunto de motores
- **THEN** el cambio se aplica al siguiente arranque de la traducción

#### Scenario: Ubicación
- **WHEN** el usuario abre la pestaña General
- **THEN** no aparece la elección de motores; está en Avanzado con una nota de que sirve para pruebas sin modelos

### Requirement: Gestión de modelos
La ventana SHALL mostrar el estado de los modelos de los idiomas elegidos (ausente, descargando, listo), permitir descargarlos y mostrar una barra de progreso durante la descarga.

#### Scenario: Descarga de modelos
- **WHEN** el usuario pide descargar los modelos de un par
- **THEN** se muestra una barra de progreso que avanza y, al terminar, el estado pasa a listo

#### Scenario: Error de descarga
- **WHEN** una descarga falla
- **THEN** la ventana muestra el motivo y permite reintentar

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

### Requirement: Persistencia
Los ajustes SHALL guardarse y recuperarse entre sesiones, con valores por defecto válidos si faltan o están dañados.

#### Scenario: Archivo de ajustes dañado
- **WHEN** el archivo de ajustes no se puede leer
- **THEN** la aplicación arranca con los valores por defecto y lo informa

### Requirement: Accesibilidad básica
La ventana SHALL poder usarse solo con teclado y SHALL etiquetar sus controles para lectores de pantalla.

#### Scenario: Navegación con teclado
- **WHEN** el usuario navega con la tecla Tab
- **THEN** cada control recibe el foco en un orden lógico y se identifica por su etiqueta

### Requirement: Modo y fallback
La ventana de Ajustes SHALL permitir elegir el modo (automático, solo texto, solo audio), el tiempo sin texto antes de pasar a audio (segundos) y el atajo para alternar el modo, validando los valores y guardándolos al instante. Cuando el modo requiera modelos de audio que falten SHALL indicarlo.

#### Scenario: Cambiar el modo
- **WHEN** el usuario elige "Solo audio"
- **THEN** el ajuste se guarda y la ventana lo muestra seleccionado

#### Scenario: Tiempo inválido
- **WHEN** el usuario escribe 0 o 100 segundos
- **THEN** se explica el rango permitido y no se guarda

### Requirement: Secciones en pestañas
La ventana SHALL organizar sus controles en pestañas (General, Idiomas y modelos, Apariencia, Atajos, Avanzado) con el patrón WAI-ARIA de pestañas, navegables con flechas, Inicio y Fin.

#### Scenario: Cambiar de pestaña con el teclado
- **WHEN** el foco está en una pestaña y se pulsa la flecha derecha
- **THEN** se activa y enfoca la pestaña siguiente y se muestra su panel

### Requirement: Gestión de modelos instalados
La pestaña de modelos SHALL listar los modelos instalados con su espacio ocupado y el total, permitir borrarlos con confirmación, cancelar una descarga en curso, reanudar una descarga parcial y cambiar la carpeta de modelos con validación.

#### Scenario: Borrar un modelo
- **WHEN** el usuario borra un modelo y confirma
- **THEN** el modelo desaparece de la lista de instalados y el total disminuye

#### Scenario: Borrar con una traducción en marcha
- **WHEN** hay una traducción en marcha
- **THEN** los botones de borrar están desactivados y se explica el motivo

#### Scenario: Carpeta no válida
- **WHEN** el usuario escribe una carpeta que no se puede escribir
- **THEN** se muestra el motivo junto al campo y no se guarda

### Requirement: Restablecer, importar y exportar
La ventana SHALL permitir restablecer los valores por defecto (con confirmación) y exportar/importar las preferencias en un archivo JSON que MUST NOT contener la región ni rutas de carpetas ni contenido capturado o traducido; una importación con algún valor inválido SHALL rechazarse entera con un mensaje.

#### Scenario: Importación inválida
- **WHEN** el archivo importado tiene una opacidad fuera de rango
- **THEN** no se aplica ningún cambio y se muestra qué campo es inválido

### Requirement: Validación en línea y accesibilidad
Los errores de un campo SHALL mostrarse junto a él, asociados con `aria-describedby` y `aria-invalid`, y los avisos globales SHALL anunciarse con `aria-live`. La ventana SHALL respetar el tema claro u oscuro del sistema con contraste suficiente.

#### Scenario: Valor fuera de rango
- **WHEN** el usuario escribe un tamaño de fuente de 500
- **THEN** el campo se marca como inválido y su mensaje se anuncia

### Requirement: Colores y líneas del overlay, rendimiento
La ventana SHALL permitir elegir color de texto y de fondo del overlay rechazando combinaciones con contraste menor a 4,5:1, el máximo de líneas y los parámetros de rendimiento (hilos, haz y caché) con "automático" por defecto.

#### Scenario: Contraste insuficiente
- **WHEN** el usuario elige texto gris claro sobre fondo blanco
- **THEN** se rechaza con un mensaje que indica el contraste mínimo

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
