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
- **WHEN** pasa un tiempo configurable sin traducciones nuevas y no está activo el ajuste "Mantener la traducción mientras el texto no cambie" en modo texto
- **THEN** el overlay oculta el texto

#### Scenario: Sin texto con la traducción mantenida
- **WHEN** el ajuste "Mantener la traducción mientras el texto no cambie" está activo, el modo es texto y pasa el tiempo configurable sin traducciones nuevas
- **THEN** el overlay no oculta el texto mientras la región conserve el mismo texto
