# speech-recognition Specification

## Purpose
Transcribir voz localmente, en memoria, produciendo segmentos parciales y finales.

## Requirements

### Requirement: Transcripción local de voz
El sistema SHALL transcribir audio mono f32 a 16 kHz con un modelo local (Whisper) cargado desde la carpeta de modelos, sin red y sin escribir a disco.

#### Scenario: Habla en el idioma configurado
- **WHEN** se transcribe una ventana con habla en el idioma de origen
- **THEN** se obtiene el texto dicho

#### Scenario: Idioma no soportado
- **WHEN** se carga el motor para un idioma sin token en el modelo
- **THEN** falla con un argumento inválido antes de procesar audio

#### Scenario: Modelo incompleto
- **WHEN** faltan archivos del modelo
- **THEN** el error de modelo nombra los archivos ausentes

### Requirement: Descarte de no-habla
El sistema MUST NOT devolver texto cuando el audio es silencio, ruido o una anotación del modelo (`[BLANK_AUDIO]`, `(música)`, notas musicales).

#### Scenario: Silencio
- **WHEN** se transcribe silencio o ruido de bajo nivel
- **THEN** no se devuelve texto

### Requirement: Intervenciones con parciales y final
Entre ventanas consecutivas de una intervención el sistema SHALL acumular el texto sin repetir el solape, emitir un segmento parcial con lo dicho hasta ahora y un segmento final con la frase completa cuando la ventana cierra la intervención o ésta supera 8 s.

#### Scenario: Frase en varias ventanas
- **WHEN** una frase abarca varias ventanas y la última cierra la intervención
- **THEN** las primeras producen parciales crecientes y la última un final con toda la frase

### Requirement: Latencia en tiempo real
El motor MUST transcribir una ventana de 2 s en menos de 2 s en una CPU de escritorio con 4 hilos.

#### Scenario: Ventana de 2 s
- **WHEN** se transcribe una ventana de 2 s
- **THEN** tarda menos que su duración

### Requirement: Recursos configurables
El reconocimiento de voz SHALL permitir configurar los hilos de cálculo, SHALL devolver al sistema la memoria de trabajo entre ejecuciones y SHALL cargar sus modelos en paralelo.

#### Scenario: Hilos explícitos
- **WHEN** se configuran 2 hilos
- **THEN** la transcripción usa 2 hilos y devuelve el mismo texto
