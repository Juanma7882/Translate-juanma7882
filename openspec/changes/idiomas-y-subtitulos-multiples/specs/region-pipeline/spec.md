# Spec Delta

## MODIFIED Requirements

### Requirement: Traducción de una región
Dada una región, un idioma de origen y una lista de cero a tres idiomas de destino, el pipeline SHALL capturar la región, extraer el texto, traducirlo a cada destino y emitir un evento con el texto original y la lista de traducciones, cada una con su idioma. Con una lista de destinos vacía, el pipeline SHALL emitir el texto original con una lista de traducciones vacía, sin traducir.

#### Scenario: Texto nuevo en la región
- **WHEN** aparece texto reconocible en la región con un destino
- **THEN** se emite un evento con el original y una traducción para ese destino

#### Scenario: Varios destinos
- **WHEN** aparece texto reconocible con dos destinos
- **THEN** se emite un único evento con el original y dos traducciones, en el orden de los destinos

#### Scenario: Sin destinos
- **WHEN** aparece texto reconocible y no hay destinos
- **THEN** se emite un evento con el original y ninguna traducción, sin invocar ningún traductor

#### Scenario: Un destino falla
- **WHEN** la traducción a uno de dos destinos falla
- **THEN** se informa el error de traducción, se emite el evento con la traducción del otro destino y el pipeline sigue funcionando
