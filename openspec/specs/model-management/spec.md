# model-management Specification

## Purpose
Obtener, verificar y exponer el estado de los modelos locales que usan los motores de OCR y traducción, descargándolos solo cuando hacen falta y sin escribir a disco nada que no sea un modelo.

## Requirements

### Requirement: Manifiesto de modelos
El sistema SHALL describir cada modelo en un manifiesto con identificador, archivos, origen, tamaño y huella SHA-256, y SHALL asociar a cada par de idiomas y a cada idioma de OCR los modelos que necesita.

#### Scenario: Modelos de un par de idiomas
- **WHEN** se consultan los modelos necesarios para traducir de `en` a `es` con OCR en `en`
- **THEN** el sistema devuelve la lista exacta de modelos y archivos del manifiesto

#### Scenario: Idioma sin modelos
- **WHEN** se consulta un idioma o par que el manifiesto no contempla
- **THEN** el sistema informa un error descriptivo de idioma no soportado

### Requirement: Estado de los modelos
El sistema SHALL informar, para cada modelo, si está ausente, descargándose o listo, considerando listo solo un modelo cuyos archivos existen y coinciden con la huella del manifiesto.

#### Scenario: Modelo presente e íntegro
- **WHEN** los archivos de un modelo existen y su SHA-256 coincide
- **THEN** el estado del modelo es listo

#### Scenario: Archivo corrupto
- **WHEN** un archivo de un modelo existe pero su SHA-256 no coincide
- **THEN** el estado del modelo es ausente y se descarga de nuevo al pedirlo

### Requirement: Descarga en el primer uso
El sistema SHALL descargar los modelos que falten solo cuando se piden, informando el progreso (bytes descargados y totales) y sin repetir los que ya están listos.

#### Scenario: Descarga con progreso
- **WHEN** se piden los modelos de un par de idiomas y alguno falta
- **THEN** se emiten eventos de progreso crecientes y al terminar el modelo queda listo

#### Scenario: Todo ya descargado
- **WHEN** se piden modelos que ya están listos
- **THEN** no se realiza ninguna descarga

### Requirement: Integridad y atomicidad
El sistema SHALL verificar la huella SHA-256 de cada archivo descargado antes de darlo por válido y MUST NOT dejar un archivo parcial o corrupto en la carpeta de modelos.

#### Scenario: Huella distinta
- **WHEN** el archivo descargado no coincide con la huella del manifiesto
- **THEN** se descarta, se informa un error de modelo y el modelo sigue ausente

#### Scenario: Descarga interrumpida
- **WHEN** la conexión se corta a mitad de una descarga
- **THEN** no queda ningún archivo parcial que el sistema considere válido y se informa un error de red

### Requirement: Solo modelos a disco
El sistema MUST NOT escribir a disco nada que no sea un modelo descargado (ni capturas, ni audio, ni texto, ni traducciones), y SHALL restringir la escritura a la carpeta de modelos configurada.

#### Scenario: Carpeta de modelos
- **WHEN** se descarga un modelo
- **THEN** los archivos se escriben únicamente dentro de la carpeta de modelos configurada

### Requirement: Funcionamiento sin red
Si todos los modelos necesarios están listos, el sistema SHALL operar sin acceso a la red.

#### Scenario: Sin conexión
- **WHEN** no hay red y los modelos necesarios ya están listos
- **THEN** OCR y traducción funcionan normalmente

### Requirement: Modelos de reconocimiento de voz
El manifiesto SHALL incluir modelos de voz por idioma con URL inmutable, tamaño y SHA-256 por archivo, y un manifiesto sin tabla de voz SHALL seguir siendo válido.

#### Scenario: Modelos de audio de un par
- **WHEN** se piden los modelos de audio de `en -> es`
- **THEN** son el modelo de voz del idioma de origen y la traducción del par, sin repetidos

#### Scenario: Idioma de voz sin modelo
- **WHEN** se pide un idioma sin modelo de voz
- **THEN** falla como idioma no soportado

### Requirement: Ámbitos de modelos
El estado y la descarga SHALL aceptar un ámbito `text` (por defecto), `audio` o `all`.

#### Scenario: Ámbito por defecto
- **WHEN** no se indica ámbito
- **THEN** se tratan los modelos de OCR y traducción como hasta ahora
