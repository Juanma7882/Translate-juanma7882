# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
