# app-packaging Specification

## Purpose
TBD - created by archiving change hito-6-empaquetado. Update Purpose after archive.

## Requirements

### Requirement: Objetivos de empaquetado
La app SHALL poder empaquetarse con electron-builder para win-x64, mac-arm64, mac-x64 y linux-x64 desde una sola configuración versionada, sin publicar por defecto.

#### Scenario: Paquete de Linux en modo directorio
- **WHEN** se ejecuta `electron-builder --linux dir` tras compilar el `.node` y la app
- **THEN** se genera un directorio con el ejecutable y `resources/native/` con el módulo nativo, sin publicar nada

### Requirement: Módulo nativo fuera del asar
El paquete SHALL incluir `api.js`, `index.js`, el `.node` de la plataforma y las librerías dinámicas que lo acompañen en `resources/native/`, fuera del asar.

#### Scenario: Librerías vecinas
- **WHEN** junto al `.node` hay librerías dinámicas (`.dll`, `.so`, `.dylib`)
- **THEN** el paso de preparación las copia al mismo directorio

#### Scenario: Falta el `.node`
- **WHEN** no existe ningún `.node` en el origen
- **THEN** la preparación falla con un mensaje claro y no se genera un paquete sin motor

### Requirement: Resolución del módulo nativo en ejecución
El proceso utilitario SHALL cargar el módulo nativo desde `TR_NATIVE_DIR` si está definida, si no desde `resources/native` cuando exista, y si no desde el paquete `tr-bindings` (desarrollo).

#### Scenario: Aplicación empaquetada
- **WHEN** existe `process.resourcesPath/native/api.js`
- **THEN** el motor se carga de ahí y la prueba de humo `TR_SMOKE=1` pasa con el binario empaquetado

#### Scenario: Desarrollo
- **WHEN** no hay `TR_NATIVE_DIR` ni `resources/native`
- **THEN** se usa `tr-bindings` como hasta ahora

### Requirement: Contenido fuera del paquete
El empaquetado SHALL NOT incluir modelos, capturas ni configuración de usuario.

#### Scenario: Lista de archivos
- **WHEN** se inspecciona el paquete
- **THEN** no hay modelos (`models/`) ni archivos `settings.json`
