# core-ports Specification

## Purpose

Define los contratos (tipos, errores y puertos) que separan el núcleo de los motores concretos, y los dobles de prueba que permiten desarrollar y testear sin modelos ni hardware.

## Requirements

### Requirement: Puertos intercambiables
El núcleo SHALL depender únicamente de abstracciones para captura de pantalla, OCR, captura de audio, reconocimiento de voz, traducción, emisión de eventos y reloj. El núcleo MUST NOT depender de ningún motor concreto.

#### Scenario: Reemplazo de un motor
- **WHEN** se sustituye la implementación de un puerto por otra que cumple el mismo contrato
- **THEN** los pipelines funcionan sin modificar el núcleo

### Requirement: Datos solo en memoria
Los puertos SHALL intercambiar capturas, audio, texto y traducciones como datos en memoria, nunca como rutas de archivo. El sistema MUST NOT escribir esos datos a disco ni a registros de log.

#### Scenario: Ejecución completa de un pipeline
- **WHEN** un pipeline procesa frames, audio y traducciones de principio a fin
- **THEN** no se crea ni modifica ningún archivo con contenido capturado, y ningún log contiene texto, audio ni traducciones (solo metadatos como longitud o latencia)

### Requirement: Errores tipificados
Cada puerto SHALL informar fallos mediante un error tipificado por categoría (captura, OCR, reconocimiento de voz, traducción, modelo) sin interrumpir el proceso.

#### Scenario: Fallo de un motor
- **WHEN** un motor devuelve un error
- **THEN** el error llega al emisor de eventos con su categoría y el proceso no termina

### Requirement: Dobles de prueba
El sistema SHALL ofrecer implementaciones falsas y deterministas de cada puerto (captura, OCR, audio, voz, traducción, reloj) que permitan programar respuestas y fallos.

#### Scenario: Test sin motores reales
- **WHEN** un test arma un pipeline solo con dobles de prueba
- **THEN** el pipeline se ejecuta de forma determinista sin modelos, pantalla ni micrófono

### Requirement: Caché de traducciones observable
La caché de traducciones SHALL normalizar mayúsculas y espacios en la clave, SHALL no guardar textos de más de 2000 caracteres, SHALL informar su capacidad y SHALL llevar contadores de aciertos, fallos, inserciones y desalojos que no contengan texto.

#### Scenario: Variación de espacios
- **WHEN** se consulta un texto igual a otro guardado salvo por espacios y saltos de línea
- **THEN** la caché acierta

#### Scenario: Contadores
- **WHEN** se consulta, inserta y desaloja
- **THEN** los contadores reflejan exactamente esas operaciones y `clear` los pone a cero

### Requirement: Detección de cambio barata
La detección de cambio SHALL muestrear los píxeles con un paso configurable y reutilizar sus buffers, sin dejar de detectar la aparición de una línea de texto.

#### Scenario: Línea de texto nueva
- **WHEN** aparece una línea de texto sobre un fondo estable con el muestreo por defecto
- **THEN** se detecta el cambio
