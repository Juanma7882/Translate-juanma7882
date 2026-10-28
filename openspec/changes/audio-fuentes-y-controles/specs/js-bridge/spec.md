# Spec Delta

## MODIFIED Requirements

### Requirement: Comandos
La API SHALL ofrecer `startRegionTranslation(rect, from, to)`, `startAudioSubtitles(from, to, source?)`, `listAudioSources()`, `startAudioMonitor(source?)`, `stopAudioMonitor()` y `stop()`. `source` es "todo el sistema" (por defecto) o el identificador de una aplicación obtenido de `listAudioSources()`. `startAudioMonitor` abre la fuente solo para medir su nivel y devuelve `false`, sin abrir nada, si hay una sesión en marcha.

#### Scenario: Iniciar y detener
- **WHEN** JS invoca `startRegionTranslation` y luego `stop`
- **THEN** el motor arranca, emite eventos mientras corre y deja de emitirlos tras `stop`

#### Scenario: Argumentos inválidos
- **WHEN** JS invoca un comando con una región vacía o idiomas no soportados
- **THEN** el comando falla con un error descriptivo y no inicia el motor

#### Scenario: Audio de una aplicación
- **WHEN** JS invoca `startAudioSubtitles` con el identificador de una aplicación
- **THEN** el motor captura solo esa aplicación

#### Scenario: Fuente inválida
- **WHEN** JS invoca `startAudioSubtitles` con una fuente que no existe
- **THEN** el comando falla con un error descriptivo y no inicia el motor

#### Scenario: Listar fuentes
- **WHEN** JS invoca `listAudioSources`
- **THEN** recibe las aplicaciones con audio activo (nombre e identificador) o la indicación de que la plataforma no lo permite

#### Scenario: Escucha previa
- **WHEN** JS invoca `startAudioMonitor` sin ninguna sesión en marcha
- **THEN** los suscriptores a `onAudioLevel` reciben los niveles de la fuente, sin modelos descargados y sin que se emita ningún subtítulo ni traducción, hasta que JS invoca `stopAudioMonitor`

#### Scenario: La escucha cede ante una sesión
- **WHEN** JS invoca `startRegionTranslation` o `startAudioSubtitles` con la escucha activa
- **THEN** la escucha se detiene antes de que arranque la sesión, y `startAudioMonitor` devuelve `false` mientras la sesión siga en marcha

#### Scenario: La escucha sobrevive a configure
- **WHEN** JS invoca `configure` con la escucha activa y sin sesión
- **THEN** la escucha sigue midiendo la fuente

### Requirement: Eventos
La API SHALL permitir suscribirse a `onTranslation`, `onSubtitle`, `onError`, `onModelProgress` y `onAudioLevel`.

#### Scenario: Traducción emitida
- **WHEN** el motor produce una traducción
- **THEN** los suscriptores a `onTranslation` reciben original, traducción y marca de tiempo

#### Scenario: Nivel de audio
- **WHEN** hay una captura de audio activa, de una sesión o de la escucha previa
- **THEN** los suscriptores a `onAudioLevel` reciben el nivel y el pico de cada ventana como números

### Requirement: Solo texto cruza la frontera
Capturas de pantalla y audio MUST NOT cruzar hacia JavaScript. JS SHALL enviar únicamente parámetros de control y recibir únicamente texto y metadatos (incluidos niveles numéricos de audio y nombres e identificadores de aplicaciones).

#### Scenario: Región traducida
- **WHEN** el motor traduce una región
- **THEN** JS recibe eventos de texto y nunca los píxeles capturados

#### Scenario: Audio capturado
- **WHEN** el motor captura audio
- **THEN** JS recibe niveles numéricos y texto, y nunca las muestras de audio
