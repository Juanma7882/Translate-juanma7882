# Spec Delta

## ADDED Requirements

### Requirement: Modo forzado sin evento propio
El evento de cambio de modo SHALL emitirse solo por el pipeline con fallback (`autoFallback: true`); con una región sin fallback o con `startAudioSubtitles` el llamador conoce el modo por la orden que dio.

#### Scenario: Solo texto
- **WHEN** se inicia una región sin fallback
- **THEN** no se emite ningún evento de modo
