## 1. Resolución del nativo en runtime

- [x] 1.1 `app/src/engine/native-path.ts`: función pura `resolveNativeEntry` + test (`native-path.test.ts`)
- [x] 1.2 `app/src/engine/worker.ts`: cargar el nativo con la ruta resuelta (fallback a `tr-bindings`)

## 2. Configuración de empaquetado

- [x] 2.1 Añadir `electron-builder` (versión fijada) y scripts `stage:native`, `pack:dir`, `dist` en `app/package.json`
- [x] 2.2 `app/electron-builder.yml` (4 objetivos, `extraResources`, exclusión de `tr-bindings`, firma condicional)
- [x] 2.3 `scripts/stage-native.mjs` (reúne `.node`, `api.js`, `index.js` y librerías vecinas)
- [x] 2.4 `scripts/verify-package.sh` (arranca el binario empaquetado con `TR_SMOKE=1`)

## 3. CI y release

- [x] 3.1 `.github/workflows/ci.yml` (matriz 3 SO, cachés, smokes con xvfb en Linux)
- [x] 3.2 `.github/workflows/release.yml` (matriz 4 objetivos, artefactos, release en borrador, firma condicional)
- [x] 3.3 Validar los YAML (parser y actionlint si se obtiene sin sudo)

## 4. Documentación

- [x] 4.1 `docs/release.md` (certificados, secretos, primer release, librerías de Linux, permisos de macOS)
- [x] 4.2 Edición pequeña de `CLAUDE.md` (comandos de empaquetado)

## 5. Verificación local (WSL)

- [x] 5.1 Compilar el `.node` y la app, `electron-builder --linux dir` sin publicar
- [x] 5.2 Arrancar el binario empaquetado con `TR_SMOKE=1` usando el `.node` empaquetado
- [x] 5.3 Pruebas existentes de `app` (typecheck, test) siguen pasando
- [x] 5.4 Documentar lo no verificado (mac/win, firma, ejecución de workflows)
