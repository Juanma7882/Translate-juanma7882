# Spec Delta

## MODIFIED Requirements

### Requirement: Traducción de segmentos finales
El pipeline SHALL traducir los segmentos finales. Los segmentos parciales MAY mostrarse sin traducir o con la traducción limitada en frecuencia. El pipeline SHALL informar al reconocimiento de voz si cada ventana cierra la intervención (silencio posterior) para que pueda emitir el segmento final.

#### Scenario: Segmento final
- **WHEN** se cierra un segmento
- **THEN** se emite un subtítulo con la traducción del texto final

#### Scenario: Ventana de cierre
- **WHEN** el silencio cierra una intervención
- **THEN** la última ventana se envía al STT marcada como de cierre; las anteriores, no

#### Scenario: STT sin soporte de cierre
- **WHEN** un motor STT no distingue ventanas de cierre
- **THEN** funciona igual que antes (el método por defecto delega en `push`)
