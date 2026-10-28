# Spec Delta

## ADDED Requirements

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
