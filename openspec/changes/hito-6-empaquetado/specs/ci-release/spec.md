## ADDED Requirements

### Requirement: Integración continua
Un workflow de CI SHALL ejecutar en push y pull request, en Linux, Windows y macOS, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, la construcción del `.node`, los tests de Node, el typecheck y la construcción de la app, y las pruebas de humo bajo xvfb en Linux.

#### Scenario: Fallo de lint
- **WHEN** clippy reporta una advertencia
- **THEN** el job falla

#### Scenario: Caché
- **WHEN** no cambian `Cargo.lock` ni los `package-lock.json`
- **THEN** las dependencias de cargo y npm se restauran de caché

### Requirement: Release por tag
Un workflow SHALL dispararse con tags `v*`, construir el `.node` y el paquete de cada plataforma y adjuntar los artefactos a una release en borrador.

#### Scenario: Tag publicado
- **WHEN** se empuja el tag `v0.1.0`
- **THEN** se generan paquetes para win-x64, mac-arm64, mac-x64 y linux-x64 y se suben a la release

### Requirement: Firma condicional
La firma y la notarización SHALL activarse solo si existen los secretos correspondientes; sin ellos el release produce paquetes sin firmar y lo indica en el log.

#### Scenario: Sin secretos
- **WHEN** `CSC_LINK` y los secretos de Apple no están definidos
- **THEN** el build continúa sin firmar ni notarizar y no falla

#### Scenario: Con secretos de Apple
- **WHEN** `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` están definidos
- **THEN** electron-builder notariza el paquete de macOS

### Requirement: Documentación de release
`docs/release.md` SHALL describir cómo obtener certificados, configurar secretos, publicar el primer release, las librerías de ejecución necesarias en Linux y los permisos de macOS.

#### Scenario: Primer release
- **WHEN** el usuario sigue el documento
- **THEN** sabe qué secretos crear y qué tag empujar
