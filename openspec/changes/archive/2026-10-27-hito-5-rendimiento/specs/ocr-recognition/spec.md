## ADDED Requirements

### Requirement: Límites de tamaño
El OCR SHALL reducir los frames cuyo lado mayor supere 3840 píxeles antes de reconocer, SHALL devolver las cajas en coordenadas del frame original y SHALL permitir configurar el lado máximo de detección (por defecto 960).

#### Scenario: Frame enorme
- **WHEN** se reconoce un frame de 4000 píxeles de ancho
- **THEN** se procesa reducido y las cajas quedan dentro del frame original

#### Scenario: Lado de detección menor
- **WHEN** se configura un lado de detección de 640
- **THEN** el texto de tamaño habitual se sigue leyendo con menor latencia
