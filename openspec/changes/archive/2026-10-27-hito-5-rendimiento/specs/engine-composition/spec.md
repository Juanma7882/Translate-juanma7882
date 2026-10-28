## ADDED Requirements

### Requirement: Rendimiento configurable y arranque paralelo
La composición SHALL pasar a los motores la afinación de rendimiento (hilos, haces, lado de detección, poca memoria), dando prioridad a lo pedido por la interfaz sobre la base, y SHALL cargar en paralelo los modelos independientes del arranque.

#### Scenario: Prioridad de la interfaz
- **WHEN** la base fija 1 haz y la interfaz pide 4
- **THEN** los motores reciben 4 haces

#### Scenario: Carga paralela
- **WHEN** se arranca una región con OCR y traducción
- **THEN** ambos modelos se cargan a la vez y un fallo de cualquiera se informa
