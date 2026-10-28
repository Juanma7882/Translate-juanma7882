# Spec Delta

## ADDED Requirements

### Requirement: Indicador de modo
El overlay SHALL mostrar el modo activo (texto, audio o pausa) como una etiqueta discreta, visible mientras hay texto y durante unos segundos tras cada cambio de modo. Al cambiar de modo el texto anterior SHALL borrarse.

#### Scenario: Paso a audio
- **WHEN** el modo activo pasa de texto a audio
- **THEN** la etiqueta muestra "Audio" y el último texto traducido ya no se ve

#### Scenario: Sin contenido persistente
- **WHEN** cambia el modo
- **THEN** la etiqueta solo contiene el nombre del modo, nunca texto capturado
