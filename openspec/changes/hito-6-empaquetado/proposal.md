# Proposal

## Why

Hasta el Hito 2 la app solo corre desde el árbol de desarrollo (`electron .` con el `.node` enlazado por `file:`). Para distribuirla hace falta un paquete por plataforma que lleve el módulo nativo y que el proceso utilitario lo encuentre fuera del asar, y una CI que lo construya y pruebe en los tres sistemas sin intervención manual. La firma y la notarización dependen de certificados que aún no se tienen: deben quedar preparadas, desactivadas y documentadas.

## What Changes

- `app/electron-builder.yml`: objetivos win-x64 (NSIS), mac-arm64 y mac-x64 (dmg + zip), linux-x64 (AppImage + deb). El módulo nativo (`api.js`, `index.js`, `*.node` y cualquier librería dinámica vecina) viaja como `extraResources` en `resources/native/`, fuera del asar.
- El utility process resuelve el módulo nativo en tiempo de ejecución: `TR_NATIVE_DIR`, o `resources/native` si existe, o el paquete `tr-bindings` (desarrollo). Cambio localizado en `app/src/engine`.
- Scripts de empaquetado (`scripts/stage-native.mjs`) que reúnen el `.node` y sus librerías vecinas, y `scripts/verify-package.sh` que comprueba el paquete en modo directorio con `TR_SMOKE=1`.
- Workflows de GitHub Actions: `ci.yml` (fmt, clippy, tests Rust y Node, typecheck, build y smokes con xvfb en Linux, matriz de 3 SO) y `release.yml` (por tag: `.node` por plataforma + electron-builder + publicación de artefactos en una release de borrador).
- Firma y notarización condicionales a secretos (`CSC_*`, `APPLE_*`, certificado de Windows), desactivadas si faltan.
- `docs/release.md`: pasos del usuario (certificados, secretos, primer release), librerías de ejecución en Linux y permisos de macOS.

## Capabilities

### New Capabilities
- `app-packaging`: configuración de electron-builder, inclusión y resolución en runtime del módulo nativo, verificación del paquete.
- `ci-release`: workflows de CI y de release, caché, firma condicional y documentación de publicación.

### Modified Capabilities
<!-- Ninguna: los requisitos funcionales del producto no cambian. -->

## Impact

- Nuevos: `.github/workflows/*.yml`, `app/electron-builder.yml`, `scripts/*`, `docs/release.md`.
- Tocados: `app/package.json` (scripts y devDependency `electron-builder`), `app/src/engine/worker.ts` (carga del nativo), un módulo nuevo `app/src/engine/native-path.ts` con su test.
- Sin cambios en `crates/**` ni en la lógica de producto.
- No verificable aquí: paquetes de Windows y macOS, firma y notarización, ejecución real de los workflows.
