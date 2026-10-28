# Spec Delta

## MODIFIED Requirements

### Requirement: Original y traducción visibles
El overlay SHALL mostrar a la vez los subtítulos elegidos (uno o dos), cada uno en su propia línea: el texto original, si su subtítulo está activo, y la traducción de cada destino, y SHALL actualizarlas cuando llega un nuevo evento. Cada línea SHALL identificar su idioma, de forma accesible, y SHALL mostrar además una etiqueta corta del idioma cuando hay dos subtítulos. Si todavía no hay ninguna traducción (por ejemplo, en un subtítulo parcial), el overlay SHALL mostrar el texto original aunque su subtítulo esté desactivado.

#### Scenario: Nueva traducción
- **WHEN** llega un evento de traducción con original y una traducción
- **THEN** el overlay muestra el original y la traducción de ese evento

#### Scenario: Dos subtítulos
- **WHEN** llega un evento con original y traducción al español, con los dos subtítulos activos
- **THEN** el overlay muestra dos líneas, primero el original y después el español, cada una con su etiqueta de idioma

#### Scenario: Dos traducciones
- **WHEN** llega un evento con traducciones al español y al francés, con el original desactivado
- **THEN** el overlay muestra dos líneas, en el orden de los destinos, cada una con su etiqueta de idioma

#### Scenario: Solo el original
- **WHEN** llega un evento sin traducciones y el subtítulo original está activo
- **THEN** el overlay muestra únicamente el texto original

#### Scenario: Subtítulo original desactivado
- **WHEN** llega un evento con traducciones y el subtítulo original está desactivado
- **THEN** el overlay muestra solo las traducciones

#### Scenario: Parcial sin traducir
- **WHEN** llega un subtítulo parcial sin traducciones y el subtítulo original está desactivado
- **THEN** el overlay muestra el texto parcial como provisional hasta que llegue el final

#### Scenario: Sin texto
- **WHEN** pasa un tiempo configurable sin traducciones nuevas
- **THEN** el overlay oculta el texto

## ADDED Requirements

### Requirement: Límite de líneas por subtítulo
El límite de líneas configurado SHALL aplicarse a cada subtítulo por separado, y la altura de la ventana SHALL ajustarse al total de líneas mostradas.

#### Scenario: Dos subtítulos con límite de una línea
- **WHEN** el límite es 1 y hay dos subtítulos con textos de tres líneas cada uno
- **THEN** cada subtítulo muestra una línea truncada con puntos suspensivos y la ventana ocupa la altura de los dos
