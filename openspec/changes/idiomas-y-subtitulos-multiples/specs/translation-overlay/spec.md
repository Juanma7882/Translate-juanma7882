# Spec Delta

## MODIFIED Requirements

### Requirement: Original y traducción visibles
El overlay SHALL mostrar a la vez las pistas de subtítulo elegidas, cada una en su propia línea: el texto original, si su pista está activa, y la traducción de cada destino, y SHALL actualizarlas cuando llega un nuevo evento. Cada línea SHALL identificar su idioma, de forma accesible, y SHALL mostrar además una etiqueta corta del idioma cuando hay más de una pista. Si todavía no hay ninguna traducción (por ejemplo, en un subtítulo parcial), el overlay SHALL mostrar el texto original aunque su pista esté desactivada.

#### Scenario: Nueva traducción
- **WHEN** llega un evento de traducción con original y una traducción
- **THEN** el overlay muestra el original y la traducción de ese evento

#### Scenario: Varias traducciones
- **WHEN** llega un evento con original y traducciones al español y al francés, con las tres pistas activas
- **THEN** el overlay muestra tres líneas, en el orden original, español, francés, cada una con su etiqueta de idioma

#### Scenario: Solo el original
- **WHEN** llega un evento sin traducciones y la pista original está activa
- **THEN** el overlay muestra únicamente el texto original

#### Scenario: Pista original desactivada
- **WHEN** llega un evento con traducciones y la pista original está desactivada
- **THEN** el overlay muestra solo las traducciones

#### Scenario: Parcial sin traducir
- **WHEN** llega un subtítulo parcial sin traducciones y la pista original está desactivada
- **THEN** el overlay muestra el texto parcial como provisional hasta que llegue el final

#### Scenario: Sin texto
- **WHEN** pasa un tiempo configurable sin traducciones nuevas
- **THEN** el overlay oculta el texto

## ADDED Requirements

### Requirement: Límite de líneas por pista
El límite de líneas configurado SHALL aplicarse a cada pista por separado, y la altura de la ventana SHALL ajustarse al total de líneas mostradas.

#### Scenario: Dos pistas con límite de una línea
- **WHEN** el límite es 1 y hay dos pistas con textos de tres líneas cada una
- **THEN** cada pista muestra una línea truncada con puntos suspensivos y la ventana ocupa la altura de las dos
