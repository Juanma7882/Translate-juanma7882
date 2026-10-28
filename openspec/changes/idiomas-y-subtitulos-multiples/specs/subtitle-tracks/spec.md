# Spec Delta

## Purpose

Definir qué pistas de subtítulo ve el usuario a la vez: el texto original del contenido y hasta tres traducciones a idiomas distintos. Permite subtitular sin traducir, comparar idiomas o leer el original junto a su traducción.

## ADDED Requirements

### Requirement: Pistas de subtítulo elegibles
El usuario SHALL poder elegir qué pistas se muestran: la pista **original** (el texto leído de la pantalla o transcrito del audio, en el idioma de origen) y entre 0 y 3 pistas de **traducción**, cada una a un idioma de destino distinto. SHALL haber al menos una pista activa. Los destinos SHALL ser distintos entre sí y distintos del idioma de origen, y cada uno SHALL tener modelo de traducción desde el origen en el manifiesto.

#### Scenario: Solo el original
- **WHEN** el usuario activa la pista original y no elige ningún destino
- **THEN** el overlay muestra únicamente el texto original, sin traducir

#### Scenario: Original y una traducción
- **WHEN** el usuario activa la pista original y elige el español como destino con origen en inglés
- **THEN** el overlay muestra el texto en inglés y su traducción al español

#### Scenario: Solo traducciones
- **WHEN** el usuario desactiva la pista original y elige español y francés como destinos
- **THEN** el overlay muestra las dos traducciones y no el original

#### Scenario: Ninguna pista
- **WHEN** el usuario intenta dejar la pista original desactivada y sin destinos
- **THEN** el cambio se rechaza con un mensaje y se conserva la configuración anterior

#### Scenario: Demasiados destinos
- **WHEN** el usuario intenta elegir un cuarto destino
- **THEN** el cambio se rechaza con un mensaje que indica el límite de tres traducciones

#### Scenario: Destino igual al origen
- **WHEN** el usuario intenta elegir como destino el mismo idioma que el de origen, o un destino repetido
- **THEN** el cambio se rechaza con un mensaje y se conserva la configuración anterior

### Requirement: Destinos disponibles según el origen
Los destinos ofrecidos SHALL ser únicamente los idiomas con modelo de traducción desde el idioma de origen elegido. Al cambiar el origen, los destinos elegidos que dejen de estar disponibles SHALL quitarse y el usuario SHALL ser avisado de cuáles; si no quedara ninguna pista activa, SHALL mantenerse la pista original.

#### Scenario: Origen con menos destinos
- **WHEN** el usuario cambia el origen de inglés a alemán, que solo traduce al inglés, teniendo elegidos español y francés
- **THEN** los destinos español y francés se quitan, se avisa de que se quitaron y queda activa la pista original

### Requirement: Subtitulado sin traducir
Con solo la pista original activa, el sistema SHALL funcionar sin cargar ni requerir ningún modelo de traducción; SHALL bastar con el modelo de reconocimiento del idioma de origen (OCR para texto en pantalla, voz para audio).

#### Scenario: Sin modelos de traducción
- **WHEN** hay instalado el modelo de OCR del inglés pero ningún modelo de traducción y se inicia con solo la pista original
- **THEN** la sesión arranca y el overlay muestra el texto leído sin error de modelos

### Requirement: Orden y fallos parciales
Las pistas SHALL mostrarse en un orden fijo: primero la original y después las traducciones en el orden en que se eligieron. Si la traducción a un destino falla, el sistema SHALL mostrar las demás pistas y SHALL informar el error de ese destino sin detener la sesión.

#### Scenario: Orden
- **WHEN** hay pista original y destinos elegidos en el orden español, francés
- **THEN** las líneas aparecen como original, español, francés

#### Scenario: Un destino falla
- **WHEN** la traducción al francés falla y la del español se completa
- **THEN** el overlay muestra el original y el español, se informa el error del francés y la sesión continúa

### Requirement: Cambios con una sesión en marcha
Cambiar los destinos o el idioma de origen con una sesión en marcha SHALL reiniciarla con la configuración nueva, porque cambian los modelos cargados. Mostrar u ocultar la pista original SHALL aplicarse de inmediato, sin reiniciar.

#### Scenario: Añadir un destino
- **WHEN** el usuario añade un destino con una sesión en marcha
- **THEN** la sesión se reinicia y el overlay incluye la nueva pista

#### Scenario: Ocultar el original
- **WHEN** el usuario desactiva la pista original con una sesión en marcha y al menos un destino activo
- **THEN** el overlay deja de mostrarla sin reiniciar la sesión

### Requirement: Persistencia y compatibilidad de la elección
La elección de pistas SHALL guardarse en los ajustes y recuperarse al reiniciar la aplicación. Los ajustes guardados o importados con un único idioma de destino SHALL interpretarse como un solo destino, con la pista original según su opción de mostrar original, sin perder ninguna otra preferencia.

#### Scenario: Ajustes anteriores
- **WHEN** la aplicación lee ajustes guardados antes de este cambio con inglés como origen y español como destino
- **THEN** quedan inglés como origen y español como único destino, y el resto de los ajustes se conserva

### Requirement: Contenido solo en memoria
Las pistas SHALL circular solo en memoria: el sistema MUST NOT escribir a disco ni a registros el texto original ni ninguna traducción de ninguna pista.

#### Scenario: Sesión con varias pistas
- **WHEN** una sesión muestra original y dos traducciones
- **THEN** no se escribe a disco ni a registros ningún texto de las tres pistas
