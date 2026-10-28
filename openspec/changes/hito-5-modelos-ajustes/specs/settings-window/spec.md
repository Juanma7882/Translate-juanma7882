# Spec Delta

## ADDED Requirements

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
