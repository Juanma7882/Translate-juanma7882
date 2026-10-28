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
El sistema SHALL verificar la huella SHA-256 de cada archivo descargado antes de darlo por válido y MUST NOT dejar un archivo final parcial o corrupto en la carpeta de modelos; los parciales usan la extensión `.part`, nunca se consideran válidos y solo se conservan tras una cancelación o un corte de red para poder reanudarlos.

#### Scenario: Huella distinta
- **WHEN** el archivo descargado no coincide con la huella del manifiesto
- **THEN** se descarta incluido su parcial, se informa un error de modelo y el modelo sigue ausente

#### Scenario: Descarga interrumpida
- **WHEN** la conexión se corta a mitad de una descarga
- **THEN** no queda ningún archivo final que el sistema considere válido, se informa un error de red y el parcial se conserva para reanudar

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

### Requirement: Uso de disco por modelo
El sistema SHALL informar, para cada modelo del manifiesto, los bytes que ocupa en disco (archivos finales y parciales) y el total de la carpeta de modelos, sin leer el contenido de los archivos.

#### Scenario: Espacio por modelo y total
- **WHEN** hay dos modelos descargados y un parcial de un tercero
- **THEN** el inventario muestra los bytes de cada uno, marca el parcial y el total es la suma

### Requirement: Borrado seguro de modelos
El sistema SHALL poder borrar un modelo y MUST borrar únicamente los archivos que el manifiesto asigna a ese modelo (y sus parciales) dentro de `<carpeta>/<id>`, rechazando ids que no sean un único componente de ruta, carpetas que sean enlaces simbólicos y modelos con una descarga en curso.

#### Scenario: Borrar un modelo listo
- **WHEN** el usuario borra un modelo listo
- **THEN** sus archivos desaparecen, su estado pasa a ausente y no se toca nada más de la carpeta

#### Scenario: Id con ruta
- **WHEN** se pide borrar `../otro` o un id desconocido
- **THEN** se rechaza como argumento inválido y no se borra nada

#### Scenario: Modelo descargándose
- **WHEN** se pide borrar un modelo que se está descargando
- **THEN** se rechaza y la descarga sigue

### Requirement: Cancelar descargas
El sistema SHALL poder cancelar la descarga en curso, devolviendo un error de cancelación y conservando el avance parcial para reanudarlo.

#### Scenario: Cancelar a mitad
- **WHEN** el usuario cancela una descarga al 40 %
- **THEN** la descarga termina con un error de cancelación, el modelo sigue ausente y queda un parcial reanudable

### Requirement: Reanudar descargas
El sistema SHALL reanudar un archivo parcial con una petición `Range` cuando el servidor responde `206` con el rango pedido, SHALL reiniciarlo desde cero si responde `200`, y SHALL verificar el SHA-256 del archivo completo antes de darlo por válido; un parcial cuyo resultado final no coincide se descarta.

#### Scenario: Servidor con Range
- **WHEN** se reanuda una descarga con 50 KB ya descargados y el servidor admite `Range`
- **THEN** solo se transfieren los bytes restantes, el progreso parte de lo ya descargado y el archivo final coincide con la huella

#### Scenario: Servidor sin Range
- **WHEN** el servidor ignora `Range` y responde `200`
- **THEN** la descarga se reinicia desde cero y termina correctamente

#### Scenario: Parcial corrupto
- **WHEN** el parcial existente tiene datos distintos a los del servidor
- **THEN** la verificación final falla, el parcial se descarta y el siguiente intento empieza desde cero

### Requirement: Carpeta de modelos validada
El sistema SHALL validar una carpeta de modelos candidata (ruta absoluta sin `..`, no raíz, carpeta existente o creable y con permiso de escritura) y MUST informar el motivo cuando no sea válida.

#### Scenario: Carpeta no escribible
- **WHEN** se valida una ruta que es un archivo o no se puede escribir
- **THEN** la validación falla con un motivo y la configuración no cambia
