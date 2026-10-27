# ocr-recognition Specification

## Purpose
Reconocer en local el texto presente en una imagen de pantalla, con soporte de varios alfabetos mediante modelos descargables, sin enviar datos fuera del equipo.

## Requirements

### Requirement: Reconocimiento de texto
El sistema SHALL reconocer el texto de una imagen y devolverlo como bloques con su texto, su posición dentro de la imagen y su confianza, en orden de lectura.

#### Scenario: Imagen con texto
- **WHEN** se reconoce una imagen que contiene una frase legible en el idioma configurado
- **THEN** se obtienen bloques cuyo texto, unido, equivale a la frase y cuyas cajas caen dentro de la imagen

#### Scenario: Imagen sin texto
- **WHEN** se reconoce una imagen sin texto
- **THEN** se devuelve una lista vacía sin error

### Requirement: Idioma y modelos
El sistema SHALL elegir los modelos de OCR según el idioma de origen configurado y SHALL informar un error de modelo si faltan, sin intentar reconocer con otro idioma.

#### Scenario: Modelos ausentes
- **WHEN** se intenta reconocer sin que los modelos del idioma estén listos
- **THEN** se informa un error de modelo que indica cuáles faltan

#### Scenario: Idioma no soportado
- **WHEN** el idioma de origen no tiene modelos de OCR en el manifiesto
- **THEN** se informa un error de idioma no soportado

### Requirement: Procesamiento local
El reconocimiento MUST ejecutarse en el equipo del usuario y MUST NOT enviar la imagen ni el texto a ningún servicio externo.

#### Scenario: Sin red
- **WHEN** se reconoce una imagen sin conexión a la red y con los modelos listos
- **THEN** el reconocimiento funciona

### Requirement: Imágenes en memoria
El reconocimiento MUST NOT escribir la imagen, el texto ni resultados intermedios a disco.

#### Scenario: Ejecución completa
- **WHEN** se reconoce una imagen
- **THEN** no se crea ningún archivo con contenido de la imagen o del texto
