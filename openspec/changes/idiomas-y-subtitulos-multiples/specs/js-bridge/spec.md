# Spec Delta

## MODIFIED Requirements

### Requirement: Comandos
La API SHALL ofrecer `startRegionTranslation(rect, from, to)`, `startAudioSubtitles(from, to, source)` y `stop()`, donde `to` es una lista de cero a tres idiomas de destino.

#### Scenario: Iniciar y detener
- **WHEN** JS invoca `startRegionTranslation` y luego `stop`
- **THEN** el motor arranca, emite eventos mientras corre y deja de emitirlos tras `stop`

#### Scenario: Argumentos inválidos
- **WHEN** JS invoca un comando con una región vacía o idiomas no soportados
- **THEN** el comando falla con un error descriptivo y no inicia el motor

#### Scenario: Lista de destinos inválida
- **WHEN** JS invoca un comando con más de tres destinos, un destino repetido o un destino igual al origen
- **THEN** el comando falla con un error de argumento inválido y no inicia el motor

#### Scenario: Sin destinos
- **WHEN** JS invoca un comando con una lista de destinos vacía
- **THEN** el motor arranca y emite eventos con el texto original y ninguna traducción

### Requirement: Eventos
La API SHALL permitir suscribirse a `onTranslation`, `onSubtitle`, `onError` y `onModelProgress`. Los eventos de traducción y de subtítulo SHALL llevar el texto original y una lista de traducciones, cada una con su código de idioma y su texto, en el orden de los destinos.

#### Scenario: Traducción emitida
- **WHEN** el motor produce una traducción con dos destinos
- **THEN** los suscriptores a `onTranslation` reciben original, una lista con las dos traducciones (idioma y texto) y marca de tiempo

#### Scenario: Subtítulo parcial
- **WHEN** el motor emite un subtítulo parcial
- **THEN** `onSubtitle` lo entrega con la lista de traducciones vacía

### Requirement: Estado y descarga de modelos
La API SHALL ofrecer `modelStatus(from, to)` y `downloadModels(from, to)`, donde `to` es una lista de destinos (posiblemente vacía); la descarga informa su avance por `onModelProgress` y termina informando éxito o un error descriptivo.

#### Scenario: Estado de modelos
- **WHEN** JS invoca `modelStatus` para un origen y una lista de destinos
- **THEN** recibe, por cada modelo necesario sin repetidos, su identificador, su estado y su tamaño

#### Scenario: Descarga con progreso
- **WHEN** JS invoca `downloadModels` para destinos con modelos ausentes
- **THEN** recibe eventos `onModelProgress` crecientes y la llamada termina cuando todos están listos

#### Scenario: Par no soportado
- **WHEN** JS invoca `modelStatus` o `downloadModels` con un destino que no está en el manifiesto para ese origen
- **THEN** la llamada falla con un error descriptivo de idioma no soportado

#### Scenario: Sin destinos
- **WHEN** JS invoca `modelStatus` con una lista de destinos vacía
- **THEN** recibe solo los modelos de reconocimiento del origen

### Requirement: Ámbito en estado y descarga de modelos
`modelStatus` y `downloadModels` SHALL aceptar un tercer parámetro opcional `scope` (`text`, `audio` o `all`; por defecto `text`) y rechazar valores desconocidos como argumento inválido. `modelCatalog` SHALL incluir `sttLanguages`.

#### Scenario: Modelos de audio
- **WHEN** se llama `modelStatus('en', ['es'], 'audio')`
- **THEN** devuelve el modelo de voz y la traducción

#### Scenario: Ámbito inválido
- **WHEN** `scope` es desconocido
- **THEN** la promesa se rechaza con `InvalidArg`

### Requirement: Subtítulos con motores reales
`startAudioSubtitles` con `engines: 'real'` SHALL arrancar la captura del sistema y emitir `onSubtitle` parciales (sin traducir) y finales (con la traducción de cada destino); sin modelos falla listando los ausentes.

#### Scenario: Sin modelos
- **WHEN** se llama sin los modelos descargados
- **THEN** lanza un error `missing models: ...` y no emite eventos
