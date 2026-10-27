# Spec Delta

## Purpose

Traducir el texto que aparece en una región de la pantalla, evitando trabajo repetido cuando la imagen o el texto no cambian.

## ADDED Requirements

### Requirement: Traducción de una región
Dada una región, un idioma de origen y uno de destino, el pipeline SHALL capturar la región, extraer el texto, traducirlo y emitir un evento con el texto original y la traducción.

#### Scenario: Texto nuevo en la región
- **WHEN** aparece texto reconocible en la región
- **THEN** se emite un evento de traducción con original y traducción

### Requirement: Omitir frames sin cambios
El pipeline SHALL detectar que un frame es equivalente al anterior y, en ese caso, MUST NOT ejecutar el reconocimiento de texto.

#### Scenario: Frames idénticos
- **WHEN** llegan dos frames consecutivos sin diferencias
- **THEN** el motor de OCR se invoca una sola vez

### Requirement: Estabilización del texto
El pipeline SHALL emitir un texto solo cuando se reconoce igual en dos frames consecutivos, para no traducir subtítulos que aparecen a medias.

#### Scenario: Texto que cambia entre frames
- **WHEN** el texto reconocido difiere entre dos frames consecutivos
- **THEN** no se emite traducción hasta que el texto se repita en dos frames seguidos

### Requirement: Caché de traducciones en memoria
El pipeline SHALL reutilizar traducciones ya calculadas para la misma combinación de texto normalizado, idioma de origen y de destino, con un tamaño máximo acotado, y MUST NOT persistirlas.

#### Scenario: Texto repetido
- **WHEN** el mismo texto vuelve a aparecer después de otro texto
- **THEN** se emite la traducción sin invocar al traductor

#### Scenario: Caché llena
- **WHEN** se supera el tamaño máximo de la caché
- **THEN** se descartan las entradas menos usadas recientemente

### Requirement: Backpressure
Si el reconocimiento es más lento que la captura, el pipeline SHALL descartar frames antiguos y procesar el más reciente.

#### Scenario: OCR lento
- **WHEN** llegan varios frames mientras el OCR procesa uno
- **THEN** al terminar se procesa solo el frame más reciente

### Requirement: Detención
El pipeline SHALL detenerse al recibir la orden de parar y liberar sus recursos sin emitir más eventos.

#### Scenario: Parar durante el procesamiento
- **WHEN** se ordena detener el pipeline
- **THEN** no se emiten eventos posteriores a la confirmación de la detención
