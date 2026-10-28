# subtitle-tracks Specification

## Purpose
Definir qué subtítulos ve el usuario a la vez: uno o dos, cada uno en un idioma distinto, que pueden ser el texto original del contenido y/o traducciones. Permite subtitular sin traducir, comparar idiomas o leer el original junto a su traducción.

## Requirements

### Requirement: Uno o dos subtítulos en idiomas distintos
El usuario SHALL poder activar uno o dos subtítulos a la vez, cada uno en un idioma distinto. Un subtítulo puede ser el **texto original** (el leído de la pantalla o transcrito del audio, en el idioma de origen) o la **traducción** a un idioma de destino. SHALL haber al menos un subtítulo activo y como máximo dos, contando el original como uno. Los destinos SHALL ser distintos entre sí y distintos del idioma de origen, y cada uno SHALL tener modelo de traducción desde el origen en el manifiesto.

#### Scenario: Solo el original
- **WHEN** el usuario activa un único subtítulo con el texto original y no elige ningún destino
- **THEN** el overlay muestra únicamente el texto original, sin traducir

#### Scenario: Solo una traducción
- **WHEN** el usuario activa un único subtítulo con el español como destino y origen en inglés
- **THEN** el overlay muestra solo la traducción al español

#### Scenario: Original y una traducción
- **WHEN** el usuario activa el original y el español como destino con origen en inglés
- **THEN** el overlay muestra el texto en inglés y su traducción al español

#### Scenario: Dos traducciones
- **WHEN** el usuario desactiva el original y elige español y francés como destinos
- **THEN** el overlay muestra las dos traducciones y no el original

#### Scenario: Ningún subtítulo
- **WHEN** el usuario intenta dejar sin ningún subtítulo activo
- **THEN** el cambio se rechaza con un mensaje y se conserva la configuración anterior

#### Scenario: Tercer subtítulo
- **WHEN** el usuario intenta activar un tercer subtítulo, por ejemplo el original más dos destinos
- **THEN** el cambio se rechaza con un mensaje que indica el límite de dos subtítulos

#### Scenario: Destino igual al origen o repetido
- **WHEN** el usuario intenta elegir como destino el mismo idioma que el de origen, o el mismo destino dos veces
- **THEN** el cambio se rechaza con un mensaje y se conserva la configuración anterior

### Requirement: Destinos disponibles según el origen
Los destinos ofrecidos SHALL ser únicamente los idiomas con modelo de traducción desde el idioma de origen elegido. Al cambiar el origen, los destinos elegidos que dejen de estar disponibles SHALL quitarse y el usuario SHALL ser avisado de cuáles; si no quedara ningún subtítulo activo, SHALL mantenerse el original.

#### Scenario: Origen con menos destinos
- **WHEN** el usuario cambia el origen de inglés a alemán, que solo traduce al inglés, teniendo elegidos español y francés
- **THEN** los destinos español y francés se quitan, se avisa de que se quitaron y queda activo el subtítulo original

### Requirement: Subtitulado sin traducir
Con solo el subtítulo original activo, el sistema SHALL funcionar sin cargar ni requerir ningún modelo de traducción; SHALL bastar con el modelo de reconocimiento del idioma de origen (OCR para texto en pantalla, voz para audio).

#### Scenario: Sin modelos de traducción
- **WHEN** hay instalado el modelo de OCR del inglés pero ningún modelo de traducción y se inicia con solo el subtítulo original
- **THEN** la sesión arranca y el overlay muestra el texto leído sin error de modelos

### Requirement: Orden, traducción simultánea y fallos parciales
Los subtítulos SHALL mostrarse en un orden fijo: primero el original, si está activo, y después las traducciones en el orden en que se eligieron. Con dos traducciones, el sistema SHALL traducirlas **a la vez** y no una tras otra, de modo que el texto aparece cuando termina la más lenta y no cuando terminan las dos en serie. Si la traducción a un destino falla, el sistema SHALL mostrar el otro subtítulo y SHALL informar el error de ese destino sin detener la sesión.

#### Scenario: Orden
- **WHEN** están activos el original y la traducción al español
- **THEN** las líneas aparecen como original y después español

#### Scenario: Traducciones simultáneas
- **WHEN** hay dos destinos y cada traducción tarda lo mismo
- **THEN** el subtítulo se muestra tras el tiempo de una traducción y no tras la suma de las dos

#### Scenario: Un destino falla
- **WHEN** la traducción al francés falla y la del español se completa
- **THEN** el overlay muestra el subtítulo en español, se informa el error del francés y la sesión continúa

### Requirement: Cambios con una sesión en marcha
Cambiar los destinos o el idioma de origen con una sesión en marcha SHALL reiniciarla con la configuración nueva, porque cambian los modelos cargados. Mostrar u ocultar el subtítulo original SHALL aplicarse de inmediato, sin reiniciar.

#### Scenario: Añadir un destino
- **WHEN** el usuario activa el segundo subtítulo con un destino nuevo con una sesión en marcha
- **THEN** la sesión se reinicia y el overlay incluye el nuevo subtítulo

#### Scenario: Ocultar el original
- **WHEN** el usuario desactiva el subtítulo original con una sesión en marcha y un destino activo
- **THEN** el overlay deja de mostrarlo sin reiniciar la sesión

### Requirement: Persistencia y compatibilidad de la elección
La elección de subtítulos SHALL guardarse en los ajustes y recuperarse al reiniciar la aplicación. Los ajustes guardados o importados con un único idioma de destino SHALL interpretarse como un solo destino, con el subtítulo original según su opción de mostrar original, sin perder ninguna otra preferencia.

#### Scenario: Ajustes anteriores
- **WHEN** la aplicación lee ajustes guardados antes de este cambio con inglés como origen y español como destino
- **THEN** quedan inglés como origen y español como único destino, y el resto de los ajustes se conserva

### Requirement: Contenido solo en memoria
Los subtítulos SHALL circular solo en memoria: el sistema MUST NOT escribir a disco ni a registros el texto original ni ninguna traducción.

#### Scenario: Sesión con dos subtítulos
- **WHEN** una sesión muestra el original y una traducción
- **THEN** no se escribe a disco ni a registros ningún texto de los dos subtítulos
