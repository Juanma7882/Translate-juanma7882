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

### Requirement: Decodificación con caché
El sistema SHALL usar la caché de claves/valores del decoder cuando el modelo la ofrece, de modo que cada paso procese un solo token, y SHALL traducir igualmente con un decoder sin caché.

#### Scenario: Decoder con caché
- **WHEN** la carpeta del modelo trae el decoder con `use_cache_branch`
- **THEN** se traduce con caché y el resultado voraz coincide con las frases de referencia

#### Scenario: Decoder sin caché
- **WHEN** el decoder no trae caché
- **THEN** se traduce reenviando la secuencia, con el mismo contrato

### Requirement: Búsqueda configurable
El sistema SHALL ofrecer búsqueda por haces con entre 1 y 8 haces, donde 1 es la decodificación voraz y es el valor por defecto, y SHALL acotar cualquier valor fuera de rango.

#### Scenario: Haces fuera de rango
- **WHEN** se configuran 0 o 99 haces
- **THEN** se usan 1 u 8 respectivamente

#### Scenario: Varios haces
- **WHEN** se configuran 4 haces
- **THEN** la traducción termina dentro de los mismos límites de longitud y devuelve texto no vacío

### Requirement: Pares de idiomas adicionales
El manifiesto SHALL incluir pares de traducción adicionales basados en modelos Opus-MT cuantizados con URL fijada por commit, tamaño y SHA-256 medidos, y cada par SHALL traducir una frase real con el motor existente sin cambios en el núcleo.

#### Scenario: Catálogo ampliado
- **WHEN** se consulta el catálogo
- **THEN** incluye, además de en<->es, los pares en<->fr, en<->de, en<->it y es<->fr

#### Scenario: Frase real
- **WHEN** se traduce una frase de ejemplo con cada modelo nuevo
- **THEN** la salida es no vacía y distinta de la entrada
