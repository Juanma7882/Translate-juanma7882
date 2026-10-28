## ADDED Requirements

### Requirement: Decodificación con caché
El sistema SHALL usar la caché de claves/valores del decoder cuando el modelo la ofrece, de modo que cada paso procese un solo token, y SHALL traducir igualmente con un decoder sin caché.

#### Scenario: Decoder con caché
- **WHEN** la carpeta del modelo trae el decoder con `use_cache_branch`
- **THEN** se traduce con caché y el resultado voraz coincide con las frases de referencia

#### Scenario: Decoder sin caché
- **WHEN** el decoder no trae caché
- **THEN** se traduce reenviando la secuencia, con el mismo contrato

### Requirement: Búsqueda configurable
El sistema SHALL ofrecer búsqueda por haces con entre 1 y 8 haces, donde 1 es la decodificación voraz y es el valor por defecto, y SHALL acotar cualquier valor fuera de rango.

#### Scenario: Haces fuera de rango
- **WHEN** se configuran 0 o 99 haces
- **THEN** se usan 1 u 8 respectivamente

#### Scenario: Varios haces
- **WHEN** se configuran 4 haces
- **THEN** la traducción termina dentro de los mismos límites de longitud y devuelve texto no vacío
