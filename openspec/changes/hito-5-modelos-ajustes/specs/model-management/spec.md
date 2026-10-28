# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Integridad y atomicidad
El sistema SHALL verificar la huella SHA-256 de cada archivo descargado antes de darlo por válido y MUST NOT dejar un archivo final parcial o corrupto en la carpeta de modelos; los parciales usan la extensión `.part`, nunca se consideran válidos y solo se conservan tras una cancelación o un corte de red para poder reanudarlos.

#### Scenario: Huella distinta
- **WHEN** el archivo descargado no coincide con la huella del manifiesto
- **THEN** se descarta incluido su parcial, se informa un error de modelo y el modelo sigue ausente

#### Scenario: Descarga interrumpida
- **WHEN** la conexión se corta a mitad de una descarga
- **THEN** no queda ningún archivo final que el sistema considere válido, se informa un error de red y el parcial se conserva para reanudar
