# text-translation Specification

## Purpose
Traducir texto en local entre un idioma de origen y uno de destino con modelos descargables, de forma que el texto nunca salga del equipo.

## Requirements

### Requirement: Traducción entre idiomas
El sistema SHALL traducir un texto del idioma de origen al de destino configurados y devolver el resultado como texto.

#### Scenario: Frase corta
- **WHEN** se traduce una frase de uso común del inglés al español
- **THEN** el resultado es una frase en español con el mismo significado

#### Scenario: Texto vacío
- **WHEN** se traduce un texto vacío o solo con espacios
- **THEN** el resultado es vacío sin error

### Requirement: Pares y modelos
El sistema SHALL traducir únicamente los pares de idiomas del manifiesto y SHALL informar un error de modelo si faltan los modelos del par, sin traducir con otro par.

#### Scenario: Par no soportado
- **WHEN** se pide traducir un par que el manifiesto no contempla
- **THEN** se informa un error de idioma no soportado

#### Scenario: Modelos ausentes
- **WHEN** se pide traducir y los modelos del par no están listos
- **THEN** se informa un error de modelo que indica cuáles faltan

### Requirement: Procesamiento local
La traducción MUST ejecutarse en el equipo del usuario y MUST NOT enviar el texto a ningún servicio externo.

#### Scenario: Sin red
- **WHEN** se traduce sin conexión a la red y con los modelos listos
- **THEN** la traducción funciona

### Requirement: Longitud acotada
El sistema SHALL acotar la longitud de la traducción generada y SHALL terminar siempre, también ante entradas largas o repetitivas.

#### Scenario: Entrada larga
- **WHEN** se traduce un texto muy largo
- **THEN** la operación termina en un tiempo acotado y devuelve una traducción o un error, sin colgarse

### Requirement: Uso concurrente
El traductor SHALL poder usarse desde varios hilos a la vez sin corromper resultados.

#### Scenario: Dos hilos
- **WHEN** dos hilos traducen textos distintos a la vez
- **THEN** cada uno recibe la traducción de su propio texto

### Requirement: Texto solo en memoria
La traducción MUST NOT escribir el texto de entrada ni el resultado a disco.

#### Scenario: Ejecución completa
- **WHEN** se traduce un texto
- **THEN** no se crea ningún archivo con ese texto o su traducción
