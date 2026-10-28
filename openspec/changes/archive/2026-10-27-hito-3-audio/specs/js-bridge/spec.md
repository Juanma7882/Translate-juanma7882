# Spec Delta

## ADDED Requirements

### Requirement: Ámbito en estado y descarga de modelos
`modelStatus` y `downloadModels` SHALL aceptar un tercer parámetro opcional `scope` (`text`, `audio` o `all`; por defecto `text`) y rechazar valores desconocidos como argumento inválido. `modelCatalog` SHALL incluir `sttLanguages`.

#### Scenario: Modelos de audio
- **WHEN** se llama `modelStatus('en','es','audio')`
- **THEN** devuelve el modelo de voz y la traducción

#### Scenario: Ámbito inválido
- **WHEN** `scope` es desconocido
- **THEN** la promesa se rechaza con `InvalidArg`

### Requirement: Subtítulos con motores reales
`startAudioSubtitles` con `engines: 'real'` SHALL arrancar la captura del sistema y emitir `onSubtitle` parciales (sin traducir) y finales (traducidos); sin modelos falla listando los ausentes.

#### Scenario: Sin modelos
- **WHEN** se llama sin los modelos descargados
- **THEN** lanza un error `missing models: ...` y no emite eventos
