# Spec Delta

## ADDED Requirements

### Requirement: Modelos protegidos durante una sesión
La aplicación MUST NOT borrar modelos ni cambiar la carpeta de modelos mientras haya una traducción en marcha, y SHALL explicar el motivo al usuario.

#### Scenario: Sesión en marcha
- **WHEN** hay una traducción en marcha y se pide borrar un modelo
- **THEN** la petición se rechaza con un aviso y los archivos no cambian

### Requirement: Carpeta de modelos validada
Antes de guardar una nueva carpeta de modelos la aplicación SHALL validarla con el motor y conservar la anterior si no es válida.

#### Scenario: Cambio de carpeta válido
- **WHEN** el usuario elige una carpeta escribible
- **THEN** se guarda y el siguiente arranque usa esa carpeta
