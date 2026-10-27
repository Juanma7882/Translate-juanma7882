# Spec Delta

## Purpose

Capturar en memoria el audio que suena por el dispositivo de salida del sistema.

## ADDED Requirements

### Requirement: Captura del audio del sistema
El sistema SHALL capturar el audio del dispositivo de salida por defecto y entregarlo como trozos mono f32 a 16 kHz de 100 ms con instantes de inicio consecutivos.

#### Scenario: Audio reproduciéndose
- **WHEN** suena audio por los altavoces con la captura activa
- **THEN** el callback recibe trozos con ese audio

#### Scenario: Sin servidor o dispositivo de sonido
- **WHEN** no hay servidor de sonido o dispositivo de salida
- **THEN** `start` falla con un error de captura descriptivo y no queda ningún hilo

### Requirement: Normalización de formato
La captura SHALL mezclar a mono y remuestrear a 16 kHz con un filtro antialias, de forma que el resultado no dependa de cómo se parta la entrada.

#### Scenario: Dispositivo a 48 kHz estéreo
- **WHEN** el dispositivo entrega 48 kHz estéreo
- **THEN** un tono de 1 kHz conserva su frecuencia y nivel, y uno de 12 kHz queda atenuado

### Requirement: Detención y reinicio
`stop` SHALL cerrar la conexión, esperar al hilo de captura y ser idempotente; tras detener no se entregan trozos y la captura puede reiniciarse.

#### Scenario: Detener y volver a arrancar
- **WHEN** se detiene la captura y se arranca de nuevo
- **THEN** vuelve a entregar trozos y arrancar dos veces seguidas es un error

### Requirement: Solo en memoria
El audio MUST NOT escribirse a disco ni a registros.

#### Scenario: Registros
- **WHEN** se ejecutan los análisis de APIs de escritura y de impresión
- **THEN** `tr-adapters` no las usa
