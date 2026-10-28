# js-bridge Specification

## Purpose

Exponer a JavaScript una API pequeña y estable para controlar el motor y recibir eventos, sin que datos de pantalla o audio crucen la frontera.

## Requirements

### Requirement: Comandos
La API SHALL ofrecer `startRegionTranslation(rect, from, to)`, `startAudioSubtitles(from, to)` y `stop()`.

#### Scenario: Iniciar y detener
- **WHEN** JS invoca `startRegionTranslation` y luego `stop`
- **THEN** el motor arranca, emite eventos mientras corre y deja de emitirlos tras `stop`

#### Scenario: Argumentos inválidos
- **WHEN** JS invoca un comando con una región vacía o idiomas no soportados
- **THEN** el comando falla con un error descriptivo y no inicia el motor

### Requirement: Eventos
La API SHALL permitir suscribirse a `onTranslation`, `onSubtitle`, `onError` y `onModelProgress`.

#### Scenario: Traducción emitida
- **WHEN** el motor produce una traducción
- **THEN** los suscriptores a `onTranslation` reciben original, traducción y marca de tiempo

### Requirement: Evento de cambio de modo
La API SHALL permitir suscribirse a `onModeChanged`, que informa el modo activo (`text`, `audio` o `paused`) al iniciar una traducción de región y cada vez que cambia.

#### Scenario: Inicio con fallback automático
- **WHEN** se inicia una traducción de región con el paso automático a audio activado
- **THEN** `onModeChanged` informa `text` como primer modo

### Requirement: Configuración del motor
La API SHALL ofrecer `configure(options)` con opciones opcionales: conjunto de motores (reales o de demostración), carpeta de modelos, intervalo de captura, paso automático a audio y sus tiempos, y latencia simulada de los motores de demostración. Las opciones se aplican al siguiente arranque y detienen lo que estuviera en marcha.

#### Scenario: Activar el paso automático a audio
- **WHEN** JS invoca `configure({ autoFallback: true })` y luego inicia una traducción de región
- **THEN** el motor opera con paso automático entre texto y audio

#### Scenario: Elegir motores reales
- **WHEN** JS invoca `configure({ engines: 'real', modelsDir })` y luego inicia una traducción de región con los modelos listos
- **THEN** el motor usa captura, OCR y traducción reales

#### Scenario: Motores no soportados
- **WHEN** JS invoca `configure` con un conjunto de motores que no existe
- **THEN** la llamada falla con un error descriptivo y no cambia la configuración

### Requirement: Garantías del arranque y de la parada
Un arranque con argumentos inválidos MUST NOT interrumpir lo que ya estuviera en marcha. Tras `stop()` no SHALL llegar ningún evento a los suscriptores, incluidos los que ya estuvieran en cola hacia JS.

#### Scenario: Arranque inválido durante una sesión
- **WHEN** hay una traducción en marcha y JS intenta iniciar otra con una región vacía
- **THEN** el comando falla y la sesión original sigue emitiendo eventos

#### Scenario: Eventos en cola al parar
- **WHEN** JS invoca `stop()` con eventos aún pendientes de entrega
- **THEN** ningún suscriptor recibe esos eventos

### Requirement: Solo texto cruza la frontera
Capturas de pantalla y audio MUST NOT cruzar hacia JavaScript. JS SHALL enviar únicamente parámetros de control y recibir únicamente texto y metadatos.

#### Scenario: Región traducida
- **WHEN** el motor traduce una región
- **THEN** JS recibe eventos de texto y nunca los píxeles capturados

### Requirement: Sin bloqueo del llamador
Los comandos SHALL retornar sin esperar al procesamiento pesado; el trabajo se ejecuta fuera del hilo que llama.

#### Scenario: Procesamiento lento
- **WHEN** un motor tarda en responder
- **THEN** el hilo de JS sigue respondiendo

### Requirement: Aislamiento de fallos
Un fallo fatal del motor MUST NOT terminar el proceso principal de la aplicación.

#### Scenario: Pánico en el motor
- **WHEN** el motor entra en pánico
- **THEN** solo cae el proceso que lo aloja y la aplicación recibe una notificación del fallo

### Requirement: Pausa y reanudación
La API SHALL ofrecer `pause()` y `resume()`; en pausa no se captura pantalla ni se emiten traducciones, y al reanudar se vuelve al modo previo.

#### Scenario: Pausar y reanudar
- **WHEN** JS invoca `pause()` con una traducción en marcha y luego `resume()`
- **THEN** durante la pausa no llegan eventos de traducción y tras reanudar vuelven a llegar

#### Scenario: Pausa sin nada en marcha
- **WHEN** JS invoca `pause()` sin traducción en marcha
- **THEN** la llamada no falla ni inicia nada

### Requirement: Estado y descarga de modelos
La API SHALL ofrecer `modelStatus(from, to)` y `downloadModels(from, to)`; la descarga informa su avance por `onModelProgress` y termina informando éxito o un error descriptivo.

#### Scenario: Estado de modelos
- **WHEN** JS invoca `modelStatus` para un par de idiomas
- **THEN** recibe, por cada modelo necesario, su identificador, su estado y su tamaño

#### Scenario: Descarga con progreso
- **WHEN** JS invoca `downloadModels` para un par con modelos ausentes
- **THEN** recibe eventos `onModelProgress` crecientes y la llamada termina cuando todos están listos

#### Scenario: Par no soportado
- **WHEN** JS invoca `modelStatus` o `downloadModels` con un par que no está en el manifiesto
- **THEN** la llamada falla con un error descriptivo de idioma no soportado

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

### Requirement: Modo forzado sin evento propio
El evento de cambio de modo SHALL emitirse solo por el pipeline con fallback (`autoFallback: true`); con una región sin fallback o con `startAudioSubtitles` el llamador conoce el modo por la orden que dio.

#### Scenario: Solo texto
- **WHEN** se inicia una región sin fallback
- **THEN** no se emite ningún evento de modo

### Requirement: Gestión de modelos desde JS
La API SHALL exponer `modelInventory()`, `deleteModel(id)`, `cancelModelDownload()` y `validateModelsDir(path)` como promesas que no bloquean el hilo de JS. `deleteModel` MUST rechazarse con un error mientras haya una traducción en marcha.

#### Scenario: Borrar durante una sesión
- **WHEN** hay una traducción en marcha y se llama a `deleteModel`
- **THEN** la promesa se rechaza y ningún archivo cambia

#### Scenario: Cancelar una descarga
- **WHEN** se llama a `cancelModelDownload` durante `downloadModels`
- **THEN** `downloadModels` se rechaza con un error de cancelación

### Requirement: Opciones de rendimiento
`EngineOptions` SHALL aceptar un campo opcional `performance` con `intraThreads` (1 a 64), `beamWidth` (1 a 8) y `cacheCapacity` (1 a 1 000 000); los valores fuera de rango SHALL rechazarse como argumento inválido sin cambiar el estado, y la ausencia del campo SHALL usar los valores por defecto del motor.

#### Scenario: Valor fuera de rango
- **WHEN** `configure` recibe `performance.beamWidth` igual a 0
- **THEN** falla como argumento inválido y el motor anterior sigue intacto

#### Scenario: Sin rendimiento
- **WHEN** `configure` no recibe `performance`
- **THEN** se usan los valores por defecto del motor
