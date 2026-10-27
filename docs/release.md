# Empaquetado y release

Cómo se construye, firma y publica la app. El código vive en `app/electron-builder.yml`,
`.github/workflows/ci.yml` y `.github/workflows/release.yml`.

## Qué produce cada plataforma

| Objetivo | Runner | Artefactos |
|---|---|---|
| win-x64 | `windows-2022` | instalador NSIS `.exe` |
| mac-arm64 | `macos-14` | `.dmg` y `.zip` |
| mac-x64 | `macos-15-intel` | `.dmg` y `.zip` |
| linux-x64 | `ubuntu-24.04` | `.AppImage` y `.deb` |

El `.node` de napi-rs se compila **en cada runner** (no hay compilación cruzada) y viaja en
`resources/native/` (fuera del asar) junto con `api.js`, `index.js` y las librerías dinámicas que lo
acompañen (`scripts/stage-native.mjs`). El proceso utilitario lo carga de ahí (`TR_NATIVE_DIR` >
`resources/native` > `tr-bindings` de desarrollo; `app/src/engine/native-path.ts`). Los modelos no
se empaquetan: se descargan en el primer uso.

El Linux se compila en Ubuntu 24.04 (glibc 2.39): el `.node` no arranca en distribuciones con glibc
más vieja. Si hiciera falta soportar más antiguas, mover el job de Linux a `ubuntu-22.04` (hay que
revisar la versión de pipewire disponible).

## Local (sin publicar)

```bash
cd crates/tr-bindings && npm ci && npm run build      # el .node de esta plataforma
cd ../../app && npm ci
npm run pack:dir        # build + stage + electron-builder --dir (dist/<plataforma>-unpacked)
npm run dist            # instaladores de la plataforma actual
scripts/verify-package.sh   # Linux: genera el directorio y arranca el binario con TR_SMOKE=1
```

En WSL: `LD_LIBRARY_PATH=$HOME/.local/electron-libs/usr/lib/x86_64-linux-gnu DISPLAY=:0` (ver `CLAUDE.md`).

## Primer release: pasos del usuario

1. **Sin firmar (válido para probar)**: subir el repositorio a GitHub, comprobar que CI pasa en los
   tres sistemas y empujar un tag cuyo número coincida con `app/package.json`:
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
   El workflow `Release` construye los cuatro paquetes y crea una release **en borrador** con los
   artefactos. Revisar, descargar, probar y publicar a mano. Con `workflow_dispatch` solo se
   construyen artefactos (sin release).
2. **Firmar**: obtener los certificados (abajo), crear los secretos en
   *Settings > Secrets and variables > Actions* y repetir con un tag nuevo.
3. Ver el log del paso «Decidir firma y notarización»: indica si se firma, se notariza o se omite.

### Certificados y secretos

| Plataforma | Qué obtener | Secretos |
|---|---|---|
| macOS | Cuenta de Apple Developer Program (99 USD/año). Certificado **Developer ID Application**, exportado como `.p12` desde Llavero. Contraseña de aplicación en appleid.apple.com. | `CSC_LINK` (el `.p12` en base64, `base64 -i cert.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | Certificado de firma de código (OV o EV; con EV desaparece antes el aviso de SmartScreen) de una autoridad, como `.pfx`. Algunas autoridades exigen token de hardware: en ese caso hace falta un servicio de firma en la nube y adaptar el workflow. | `WIN_CSC_LINK` (el `.pfx` en base64), `WIN_CSC_KEY_PASSWORD` |
| Linux | No se firma. | — |

Comportamiento sin secretos (el actual, porque no se tienen):

- macOS sin `CSC_LINK`: se desactiva el descubrimiento de identidad (`CSC_IDENTITY_AUTO_DISCOVERY=false`);
  sale sin firmar. Gatekeeper bloquea la apertura normal: clic derecho > Abrir, o
  `xattr -dr com.apple.quarantine Translate.app`. En arm64 un binario sin firmar puede no arrancar.
- Con `CSC_LINK` pero sin `APPLE_*`: se firma sin notarizar. Con los cinco: firma y notarización
  (`-c.mac.notarize=true`; `mac.notarize` está en `false` en `electron-builder.yml`).
- Windows sin `WIN_CSC_LINK`: instalador sin firmar; SmartScreen avisa de «editor desconocido».

## Requisitos de ejecución en Linux

El módulo nativo enlaza dinámicamente (observado con `readelf -d` en el `.node`) con `libgbm.so.1`,
`libwayland-client.so.0` y `libxcb.so.1` (captura con `xcap`); además `libstdc++`, `libgcc_s` y
glibc. Para la captura en Wayland/X11 conviene tener también `libEGL` y `libpipewire-0.3`
(portal de captura de pantalla; el audio del sistema en el Hito 3 usa PipeWire/PulseAudio y ALSA).
Electron necesita GTK 3, NSS, libXss, libXtst y libatk-bridge.

Debian/Ubuntu:

```bash
sudo apt install libgbm1 libegl1 libwayland-client0 libxcb1 libpipewire-0.3-0 libasound2t64 \
  libgtk-3-0t64 libnss3 libxss1 libxtst6 libatk-bridge2.0-0t64
```

(`libasound2` y sin `t64` en Ubuntu 22.04 / Debian 12.) El `.deb` declara las propias (`libgbm1`,
`libxcb1`, `libwayland-client0`, `libasound2`) más las de Electron; el AppImage no instala nada: hay
que tenerlas. Para compilar el `.node` se necesitan además los `-dev` (ver la lista `apt` de
`ci.yml`) y `libclang`.

En Wayland la captura de pantalla pasa por el portal (permiso del escritorio); el overlay no puede
excluirse de la captura en Linux (ver ADR 0002).

## Permisos de macOS

- **Grabación de pantalla** (Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla y
  audio del sistema): imprescindible para la captura de la región. Tras concederlo hay que
  reiniciar la app. Texto: `NSScreenCaptureUsageDescription`.
- **Audio** (Hito 3): micrófono (`NSMicrophoneUsageDescription`, entitlement
  `com.apple.security.device.audio-input`) y captura del audio del sistema
  (`NSAudioCaptureUsageDescription`, macOS 14.4+; en versiones anteriores solo hay micrófono o un
  dispositivo virtual).
- Los permisos están asociados a la firma: una app sin firmar o re-firmada pierde los permisos al
  actualizarse. Otro motivo para firmar.
- Entitlements (`app/build/entitlements.mac.plist`): `allow-jit` y `allow-unsigned-executable-memory`
  (V8) y `disable-library-validation` (carga del `.node` y de ONNX Runtime).

## Qué se verificó y qué no

Verificado en WSL (Ubuntu 24.04, linux-x64): typecheck, tests de `app` (111), build, preparación del
nativo, `electron-builder --linux dir`, y `TR_SMOKE=1` con el binario empaquetado cargando el `.node`
de `resources/native` (sin él, el motor no arranca). YAML de los workflows validado con actionlint
1.7.12 y un parser YAML.

**No verificado** (queda para la primera ejecución real): cualquier paquete de Windows y macOS;
la compilación del `.node` y `cargo test` en `windows-2022`, `macos-14` y `macos-15-intel`;
`.AppImage` y `.deb` (solo se probó el modo directorio); firma y notarización; la ejecución de los
workflows en GitHub (cachés, apt de Ubuntu 24.04, `libpipewire-0.3-dev`); actualización automática
(no implementada).
