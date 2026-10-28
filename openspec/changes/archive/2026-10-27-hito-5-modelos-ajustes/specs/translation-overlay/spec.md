# Spec Delta

## ADDED Requirements

### Requirement: Colores del overlay
El overlay SHALL aplicar el color de texto y el de fondo configurados, y la configuración MUST garantizar un contraste de al menos 4,5:1 entre ambos.

#### Scenario: Colores personalizados
- **WHEN** el usuario elige texto amarillo sobre fondo negro
- **THEN** el overlay se muestra con esos colores

### Requirement: Límite de líneas
El overlay SHALL limitar la traducción visible al número de líneas configurado (1 a 6) y ajustar la altura de la ventana.

#### Scenario: Una sola línea
- **WHEN** el límite es 1 y la traducción ocupa tres líneas
- **THEN** se muestra una línea truncada con puntos suspensivos

### Requirement: Posición manual arrastrable
El overlay SHALL poder colocarse manualmente arrastrándolo en un modo de movimiento temporal, guardando la posición, y SHALL volver a ser atravesable por el ratón y sin foco al terminar.

#### Scenario: Mover el overlay
- **WHEN** el usuario activa "Mover overlay" y arrastra el asa
- **THEN** la posición se guarda como manual y el overlay vuelve a ignorar el ratón al terminar
