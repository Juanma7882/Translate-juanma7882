# Spec Delta

## Purpose

Generar subtítulos traducidos a partir del audio del sistema, con segmentos parciales y finales, sin guardar el audio.

## ADDED Requirements

### Requirement: Subtítulos desde audio
Dados un idioma de origen y uno de destino, el pipeline SHALL recibir audio, transcribirlo y emitir subtítulos con el texto transcrito y su traducción.

#### Scenario: Habla detectada
- **WHEN** el audio contiene habla
- **THEN** se emiten segmentos parciales mientras se habla y un segmento final al cerrar la frase

### Requirement: Traducción de segmentos finales
El pipeline SHALL traducir los segmentos finales. Los segmentos parciales MAY mostrarse sin traducir o con la traducción limitada en frecuencia.

#### Scenario: Segmento final
- **WHEN** se cierra un segmento
- **THEN** se emite un subtítulo con la traducción del texto final

### Requirement: Descarte del silencio
El pipeline SHALL detectar silencio y MUST NOT enviar al reconocimiento de voz ventanas que no contienen habla.

#### Scenario: Audio en silencio
- **WHEN** el audio permanece en silencio
- **THEN** el reconocimiento de voz no se invoca y no se emiten subtítulos

### Requirement: Ventanas con solape
El pipeline SHALL procesar el audio en ventanas cortas con solape para mantener baja la latencia sin cortar palabras en los límites.

#### Scenario: Palabra en el límite de ventana
- **WHEN** una palabra cae entre dos ventanas consecutivas
- **THEN** aparece una sola vez en el texto resultante

### Requirement: Audio solo en memoria
El audio capturado MUST NOT escribirse a disco. Al detener el pipeline, los búferes de audio SHALL liberarse.

#### Scenario: Detención
- **WHEN** se ordena detener el pipeline
- **THEN** la captura de audio se detiene y no quedan datos de audio retenidos
