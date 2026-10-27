# Spec Delta

## Purpose

Integrar las ventanas y el motor en una aplicación de uso diario: icono de bandeja, atajos globales, persistencia de ajustes y un primer uso guiado.

## ADDED Requirements

### Requirement: Icono de bandeja
La aplicación SHALL mostrar un icono de bandeja con acciones para elegir región, pausar o reanudar, abrir los ajustes y salir.

#### Scenario: Pausar desde la bandeja
- **WHEN** el usuario elige pausar en el menú de la bandeja
- **THEN** la traducción se pausa y el menú ofrece reanudar

### Requirement: Atajos globales
La aplicación SHALL registrar atajos globales configurables para elegir región y para pausar o reanudar, y SHALL informar al usuario si un atajo no se pudo registrar.

#### Scenario: Elegir región con el atajo
- **WHEN** el usuario pulsa el atajo de elegir región
- **THEN** se abre el selector de región

#### Scenario: Atajo en conflicto
- **WHEN** un atajo ya está en uso por otra aplicación
- **THEN** la aplicación lo informa y sigue funcionando por la bandeja

### Requirement: Flujo completo
Al confirmar una región, la aplicación SHALL iniciar la traducción con los idiomas y motores configurados y SHALL mostrar el resultado en el overlay.

#### Scenario: Región confirmada
- **WHEN** el usuario confirma una región
- **THEN** se inicia la traducción y las traducciones aparecen en el overlay

### Requirement: Primer uso
En el primer uso, si faltan modelos, la aplicación SHALL guiar al usuario para descargarlos mostrando el progreso y SHALL avisar de que se descargará desde internet.

#### Scenario: Primer arranque sin modelos
- **WHEN** el usuario intenta traducir sin los modelos necesarios
- **THEN** la aplicación ofrece descargarlos, indica el tamaño total y muestra el progreso

### Requirement: Aviso de datos fuera del equipo
Cualquier adaptador que envíe datos fuera del equipo SHALL avisar al usuario antes de usarse. Los motores de este hito MUST NOT enviar contenido fuera del equipo; solo se descargan modelos.

#### Scenario: Descarga de modelos
- **WHEN** se descargan modelos
- **THEN** solo se transfieren los archivos del modelo y ningún contenido del usuario

### Requirement: Errores visibles sin contenido
Los errores del motor (captura, OCR, traducción, modelos) SHALL mostrarse al usuario de forma comprensible sin incluir texto capturado ni traducido.

#### Scenario: Fallo de captura
- **WHEN** la captura falla
- **THEN** el usuario ve un aviso con la causa y la aplicación sigue funcionando
