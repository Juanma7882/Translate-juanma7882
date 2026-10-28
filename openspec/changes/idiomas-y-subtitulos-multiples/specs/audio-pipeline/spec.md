# Spec Delta

## MODIFIED Requirements

### Requirement: Subtítulos desde audio
Dados un idioma de origen y una lista de cero a tres idiomas de destino, el pipeline SHALL recibir audio, transcribirlo y emitir subtítulos con el texto transcrito y la lista de sus traducciones, cada una con su idioma.

#### Scenario: Habla detectada
- **WHEN** el audio contiene habla
- **THEN** se emiten segmentos parciales mientras se habla y un segmento final al cerrar la frase

#### Scenario: Sin destinos
- **WHEN** no hay destinos y se cierra una frase
- **THEN** el subtítulo final lleva el texto transcrito y ninguna traducción, sin invocar ningún traductor

### Requirement: Traducción de segmentos finales
El pipeline SHALL traducir los segmentos finales a cada destino. Los segmentos parciales MAY mostrarse sin traducir o con la traducción limitada en frecuencia. El pipeline SHALL informar al reconocimiento de voz si cada ventana cierra la intervención (silencio posterior) para que pueda emitir el segmento final.

#### Scenario: Segmento final
- **WHEN** se cierra un segmento con dos destinos
- **THEN** se emite un subtítulo con la traducción del texto final a cada destino

#### Scenario: Un destino falla
- **WHEN** la traducción del segmento final falla para un destino y se completa para el otro
- **THEN** el subtítulo lleva solo la traducción lograda y se informa el error del destino que falló

#### Scenario: Ventana de cierre
- **WHEN** el silencio cierra una intervención
- **THEN** la última ventana se envía al STT marcada como de cierre; las anteriores, no

#### Scenario: STT sin soporte de cierre
- **WHEN** un motor STT no distingue ventanas de cierre
- **THEN** funciona igual que antes (el método por defecto delega en `push`)
