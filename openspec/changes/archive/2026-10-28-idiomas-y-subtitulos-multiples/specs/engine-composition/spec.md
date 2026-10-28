# Spec Delta

## MODIFIED Requirements

### Requirement: Preparación de modelos antes de arrancar
Con motores reales, el sistema SHALL comprobar que los modelos necesarios para el idioma de origen y para cada destino elegido están listos antes de arrancar y, si faltan, SHALL informar cuáles son sin iniciar el pipeline. Los modelos necesarios son los de reconocimiento del idioma de origen (OCR o voz según el modo) y, por cada destino, el modelo de traducción de ese par; sin destinos no se requiere ningún modelo de traducción.

#### Scenario: Modelos faltantes
- **WHEN** se inicia una traducción real y faltan modelos
- **THEN** el comando falla con un error que lista los modelos ausentes de todos los destinos, sin repetidos, y no se captura la pantalla

#### Scenario: Modelos listos
- **WHEN** todos los modelos están listos
- **THEN** el pipeline arranca sin descargas

#### Scenario: Sin destinos
- **WHEN** se inicia con motores reales, sin destinos y con el modelo de reconocimiento del origen instalado
- **THEN** el pipeline arranca aunque no haya ningún modelo de traducción instalado

#### Scenario: Un destino sin modelos
- **WHEN** se inicia con dos destinos y faltan los modelos de uno
- **THEN** el comando falla listando los del destino que falta y no arranca ninguno de los dos

### Requirement: Fallback real con un solo traductor
Con motores reales y fallback activo, texto y audio SHALL compartir una única instancia del traductor de cada destino. Cada destino elegido SHALL tener su propia instancia, cargada una sola vez por sesión.

#### Scenario: Una carga
- **WHEN** se arranca una región con fallback real
- **THEN** el modelo de traducción de cada destino se carga una sola vez

#### Scenario: Dos destinos
- **WHEN** se arranca una región con fallback real y dos destinos
- **THEN** se cargan dos traductores, uno por destino, y texto y audio usan los mismos
