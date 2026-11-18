# Spec Delta

## Purpose

Permitir al usuario conservar en disco, solo si lo activa explícitamente, la transcripción de una sesión (texto original y traducciones) en archivos `.txt` y `.srt` dentro de una carpeta que él elige.

## ADDED Requirements

### Requirement: Guardado desactivado por defecto y solo con carpeta válida
El guardado de la transcripción SHALL estar desactivado por defecto. Mientras esté desactivado, la aplicación MUST NOT escribir a disco ningún texto reconocido ni traducido. Para activarlo, el usuario SHALL elegir una carpeta de destino con un diálogo del sistema; la carpeta MUST ser una ruta absoluta existente y con permiso de escritura. Si no hay carpeta válida, la activación SHALL rechazarse con un mensaje junto al control.

#### Scenario: Primer uso
- **WHEN** el usuario inicia una sesión sin haber tocado el ajuste
- **THEN** no se crea ningún archivo de transcripción

#### Scenario: Activar sin carpeta
- **WHEN** el usuario intenta activar el guardado sin haber elegido carpeta
- **THEN** el cambio se rechaza con un mensaje que pide elegir una carpeta y el guardado sigue desactivado

#### Scenario: Carpeta no escribible
- **WHEN** el usuario elige una carpeta sin permiso de escritura
- **THEN** la carpeta se rechaza con un mensaje y se conserva la anterior

### Requirement: Escritura continua de líneas finales
Con el guardado activo, cada línea **final** de la sesión SHALL añadirse a los archivos en cuanto llega, tanto en modo audio (reconocimiento de voz) como en modo texto (OCR) y en automático. Las líneas parciales MUST NOT guardarse. En modo texto, una línea cuyo original sea idéntico al de la línea guardada inmediatamente antes MUST NOT repetirse. La escritura MUST NOT bloquear la interfaz ni retrasar la presentación del subtítulo.

#### Scenario: Audio
- **WHEN** el reconocimiento de voz produce un parcial y después la línea final «Hello everyone» traducida a «Hola a todos»
- **THEN** el archivo contiene una sola entrada con «Hello everyone» y «Hola a todos», y ninguna con el parcial

#### Scenario: Texto en pantalla repetido
- **WHEN** el OCR lee dos veces seguidas el mismo texto de la región
- **THEN** la transcripción contiene ese texto una sola vez

#### Scenario: Línea que llega tras cerrar el archivo
- **WHEN** se detiene la sesión
- **THEN** los archivos quedan completos y cerrados con todas las líneas finales recibidas hasta ese momento

### Requirement: Contenido de cada entrada
Cada entrada SHALL incluir la hora relativa al inicio de la sesión, el texto original con su idioma y una traducción por cada idioma de destino activo, en el orden de los destinos. El original SHALL guardarse aunque no se muestre en el overlay. Si todas las traducciones de una línea fallaron, la entrada SHALL guardarse solo con el original.

#### Scenario: Dos destinos
- **WHEN** el origen es inglés, los destinos son español y francés y llega la línea final «Good morning»
- **THEN** la entrada contiene la hora relativa, «[en] Good morning», «[es] Buenos días» y «[fr] Bonjour», en ese orden

#### Scenario: Original oculto en el overlay
- **WHEN** el usuario muestra solo la traducción al español
- **THEN** la entrada guardada incluye igualmente el texto original

### Requirement: Archivos por sesión en .txt y .srt
Cada sesión con el guardado activo SHALL escribir en un archivo `.txt` nuevo y, si la opción «También en .srt» está activa (por defecto sí), en un `.srt` nuevo, ambos en la carpeta elegida y con un nombre que incluye la fecha y la hora de inicio de la sesión. La aplicación MUST NOT sobrescribir un archivo existente. Pausar y reanudar SHALL continuar en los mismos archivos. El `.srt` SHALL ser válido: entradas numeradas desde 1, tiempos `HH:MM:SS,mmm --> HH:MM:SS,mmm` crecientes y no solapados, y el texto original y las traducciones como líneas de la entrada. El fin de cada entrada SHALL ser el inicio de la siguiente, acotado entre 1 y 7 segundos de duración; si la siguiente empieza antes de 1 segundo, el fin SHALL ser su inicio (nunca se solapan). La última entrada dura 7 segundos.

#### Scenario: Nombre único
- **WHEN** ya existe un archivo con el nombre que correspondería a la sesión
- **THEN** se usa otro nombre con un sufijo numérico y el existente no se modifica

#### Scenario: Pausa
- **WHEN** el usuario pausa y reanuda la sesión
- **THEN** las líneas posteriores se añaden a los mismos archivos con su hora relativa al inicio de la sesión

#### Scenario: Sin .srt
- **WHEN** el usuario desactiva «También en .srt» e inicia una sesión
- **THEN** solo se crea el `.txt`

#### Scenario: SRT legible
- **WHEN** la sesión guarda tres líneas y se detiene
- **THEN** el `.srt` tiene tres entradas numeradas 1, 2 y 3 con tiempos crecientes que un reproductor de vídeo acepta

### Requirement: Activar y desactivar durante la sesión
El usuario SHALL poder activar o desactivar el guardado desde Ajustes (pestaña General) y desde el menú de la bandeja, también con una sesión en curso. Al activarlo durante una sesión, SHALL crearse los archivos en ese momento y guardarse las líneas finales posteriores (no las anteriores). Al desactivarlo, los archivos SHALL cerrarse y no SHALL añadirse más líneas. Mientras se guarda, el overlay y la bandeja SHALL mostrar un indicador visible que diga que la transcripción se está guardando.

#### Scenario: Activar a mitad de sesión
- **WHEN** el usuario activa el guardado desde la bandeja con una sesión en curso
- **THEN** aparece el indicador y la siguiente línea final se guarda en archivos nuevos

#### Scenario: Desactivar a mitad de sesión
- **WHEN** el usuario desactiva el guardado con una sesión en curso
- **THEN** desaparece el indicador, los archivos quedan cerrados y las líneas siguientes no se escriben

### Requirement: Errores de escritura
Si la escritura falla (carpeta borrada, disco lleno, sin permisos), la aplicación SHALL avisar al usuario con una notificación que no incluya contenido de la transcripción, SHALL dejar de guardar durante el resto de esa sesión y SHALL seguir traduciendo y mostrando subtítulos con normalidad.

#### Scenario: Carpeta borrada durante la sesión
- **WHEN** la carpeta de destino deja de existir con una sesión guardando
- **THEN** se muestra un aviso, desaparece el indicador y la traducción continúa

### Requirement: Privacidad del ajuste
Las preferencias de transcripción (activación, carpeta y `.srt`) MUST NOT incluirse en la exportación de ajustes ni aplicarse desde una importación. «Restablecer» SHALL desactivar el guardado y conservar la carpeta elegida. El texto de la transcripción MUST NOT escribirse en logs ni en ningún otro archivo que no sean los de la transcripción.

#### Scenario: Exportar con guardado activo
- **WHEN** el usuario exporta sus ajustes con el guardado activo
- **THEN** el archivo exportado no contiene ninguna preferencia de transcripción

#### Scenario: Restablecer
- **WHEN** el usuario restablece los valores por defecto
- **THEN** el guardado queda desactivado y la carpeta elegida se mantiene
