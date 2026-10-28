## Context

El módulo nativo se construye con `napi build --platform` en `crates/tr-bindings` y deja `index.js` (cargador generado), `api.js` (capa fina), `*.node` y, si `ort` enlaza dinámicamente, librerías vecinas (`copy-dylibs`). `app/` lo consume como `file:../crates/tr-bindings` (symlink) y el bundle del utility process hace `require("tr-bindings")` (externalizado). Un symlink fuera de `app/` no se empaqueta de forma fiable con electron-builder.

Observado en el `.node` de Linux: NEEDED `libgbm`, `libwayland-client`, `libxcb` (xcap); `ort` está enlazado estáticamente (no hay `libonnxruntime` en el árbol de build), así que hoy no hay librerías vecinas, pero el staging copia las que aparezcan.

## Goals / Non-Goals

**Goals:** paquete por plataforma con el nativo; CI en 3 SO; release por tag; firma lista pero apagada; guía para el usuario.
**Non-Goals:** comprar/gestionar certificados; auto-update (`electron-updater`); arm64 en Windows/Linux; verificación en mac/win aquí.

## Decisions

1. **Nativo como `extraResources`, no dentro del asar ni `asarUnpack`.** `extraResources: [{from: build/native, to: native}]`. `build/native` lo llena `scripts/stage-native.mjs` (api.js, index.js, `*.node`, `*.dll|*.so*|*.dylib`). Evita depender de cómo resuelve electron-builder el symlink `file:` y mantiene el `.node` cargable por `dlopen`. `tr-bindings` se retira del empaquetado de dependencias con `files` que excluye `node_modules/tr-bindings`.
2. **Resolución en runtime** en `app/src/engine/native-path.ts` (función pura `resolveNativeEntry({env, resourcesPath, exists})`): `TR_NATIVE_DIR` > `resourcesPath/native/api.js` > `null` (usar `tr-bindings`). `worker.ts` cambia el `import` estático por `require` de la ruta resuelta, con tipos de `tr-bindings` solo como tipo. Alternativa descartada: pasar la ruta por `env` desde `EngineHost`, que toca la lógica de producto.
3. **Un `.node` por runner**, sin cross-compile: ubuntu-22.04 (glibc 2.35, compatible hacia delante), windows-2022, macos-14 (arm64) y macos-15-intel (x64). El loader de napi ya prueba `darwin-arm64`/`darwin-x64`.
4. **Dos workflows.** `ci.yml`: matriz de 3 SO para Rust y Node; los smokes (`TR_SMOKE=1`, `windows`, `selector`, `settings`, `shell`) solo en Linux con xvfb porque en mac/win hospedados no hay sesión gráfica fiable. `release.yml`: matriz de 4 objetivos, sube artefactos y un job final los adjunta a una release en borrador con `softprops/action-gh-release`.
5. **Firma condicional:** los secretos se exponen como `env` del paso de electron-builder. Sin `CSC_LINK`, electron-builder no firma; para mac se fuerza `CSC_IDENTITY_AUTO_DISCOVERY=false` y `mac.notarize` desactivado cuando no hay `APPLE_*` (un paso previo calcula `HAVE_APPLE`/`HAVE_WIN` y pasa `-c.mac.notarize=false` si faltan). Los secretos no se pueden usar en `if:` de pasos, por eso se vuelcan a variables de entorno de un paso de decisión.
6. **Versiones de acciones** verificadas el 2026-10-27 (no archivadas, publicadas en 2026): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `Swatinem/rust-cache@v2`, `dtolnay/rust-toolchain@stable`, `softprops/action-gh-release@v3`. `electron-builder` 26.18.0 (actualizado 2026-10).
7. **Seguridad de la cadena:** permisos mínimos (`contents: read`; `write` solo en el job de release), sin `pull_request_target`.
8. **Linux:** AppImage + deb. Dependencias de compilación del `.node` por `apt` (libgbm, libwayland, libxcb*, libpipewire, libasound2, libclang para bindgen); las de ejecución se documentan en `docs/release.md` y el `.deb` las declara en `deb.depends`.

## Risks / Trade-offs

- Los workflows no se pueden ejecutar aquí: se validan con parser YAML/actionlint y queda la primera ejecución real como pendiente del usuario.
- Los paquetes de Windows y macOS no se verifican; los paths de `extraResources` son iguales en todas las plataformas (`resources/native`), lo que reduce el riesgo.
- Sin firma, macOS (Gatekeeper) y Windows (SmartScreen) avisan al abrir; documentado.
- El `.node` pesa decenas de MB (modelos no incluidos): el instalador será grande.
- Cambios del agente del Hito 3 en `crates/**` (audio) pueden añadir dependencias de sistema (p. ej. ALSA, CoreAudio, WASAPI) a la lista de apt; el CI las incluye de antemano.

## Open Questions

- Si se quiere auto-update, hará falta firma y `electron-updater` (fuera de este hito).
- Si se prefiere un `.node` universal de macOS en lugar de dos.
