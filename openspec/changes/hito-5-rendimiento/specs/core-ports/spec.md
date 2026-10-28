## ADDED Requirements

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
