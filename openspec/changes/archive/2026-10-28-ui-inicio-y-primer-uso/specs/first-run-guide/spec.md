# Spec Delta

## Purpose

Guiar al usuario nuevo por los tres pasos mínimos para traducir por primera vez (descargar un idioma, elegir la región, iniciar), mostrando en cada momento cuál falta.

## ADDED Requirements

### Requirement: Pasos del primer uso
La pestaña Inicio SHALL mostrar, mientras haya pasos pendientes, una lista ordenada de tres pasos: descargar un idioma, elegir la región e iniciar la traducción. Cada paso SHALL mostrarse como hecho cuando se cumple su condición real (modelos del par activo instalados, región guardada, sesión iniciada alguna vez), sin que el usuario tenga que marcarlo, y el primer paso pendiente SHALL destacarse con un botón que lleva a hacerlo.

#### Scenario: Instalación nueva
- **WHEN** se abre la aplicación sin modelos ni región
- **THEN** la lista muestra los tres pasos pendientes y destaca el primero con un botón que abre la pestaña Idiomas

#### Scenario: Un paso se cumple
- **WHEN** termina la descarga de los modelos del par activo
- **THEN** el primer paso aparece como hecho sin recargar la ventana y se destaca el siguiente

#### Scenario: Orden flexible
- **WHEN** el usuario elige la región antes de descargar el idioma
- **THEN** el paso de la región aparece como hecho y el primer paso sigue destacado como pendiente

### Requirement: Pasos según el modo
La lista SHALL adaptarse al modo: en modo solo audio SHALL omitir el paso de la región, y el paso de descarga SHALL referirse a los modelos que ese modo necesita.

#### Scenario: Solo audio
- **WHEN** el modo es «Solo audio»
- **THEN** la lista muestra dos pasos (descargar el idioma con sus modelos de audio, e iniciar)

### Requirement: La guía termina sola
La lista SHALL ocultarse cuando los tres pasos estén cumplidos y SHALL mantenerse oculta en adelante, aunque después cambie una condición (por ejemplo, se borre un modelo); en ese caso los avisos habituales de modelos faltantes de Inicio siguen funcionando.

#### Scenario: Completar la guía
- **WHEN** el usuario completa el último paso
- **THEN** la lista desaparece y no vuelve a aparecer al reabrir la ventana

#### Scenario: Borrar un modelo después
- **WHEN** la guía ya terminó y el usuario borra un modelo
- **THEN** la lista no reaparece y Inicio avisa de los modelos que faltan

### Requirement: Guía accesible
La lista SHALL usar semántica de lista ordenada, indicar el estado de cada paso con texto (no solo con color o icono) y anunciar a lectores de pantalla cuando un paso se completa.

#### Scenario: Lector de pantalla
- **WHEN** un paso pasa a hecho
- **THEN** una región `aria-live` anuncia cuál se completó y cuál sigue
