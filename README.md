# translate

**Traductor de pantalla y audio, local y privado, para escritorio.**

Selecciona una región de la pantalla y `translate` la lee (OCR), la traduce y muestra el resultado sobre el original. Si en la región no hay texto, escucha el audio del sistema (voz a texto), lo traduce y lo muestra como subtítulos. Todo se ejecuta en tu equipo.

![Rust](https://img.shields.io/badge/Rust-1.95+-orange?logo=rust)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Plataformas](https://img.shields.io/badge/plataformas-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Licencia](https://img.shields.io/badge/licencia-MIT-green)

## Índice

- [Características](#características)
- [Motores](#motores)
- [Arquitectura](#arquitectura)
- [Instalación](#instalación)
- [Requisitos para desarrollar](#requisitos-para-desarrollar)
- [Puesta en marcha](#puesta-en-marcha)
- [Pruebas y calidad](#pruebas-y-calidad)
- [Empaquetado y releases](#empaquetado-y-releases)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Hoja de ruta](#hoja-de-ruta)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

## Características

- **Texto en pantalla**: selector de región → captura → OCR → traducción → overlay sobre el original.
- **Audio del sistema**: captura del audio de salida → reconocimiento de voz (Whisper) → traducción → subtítulos.
- **Modo automático**: si la región no tiene texto, pasa solo a audio. También puedes forzar `text` o `audio` en Ajustes.
- **Privacidad por diseño**: capturas, audio, texto y traducciones viven solo en RAM; nunca se escriben a disco ni a logs. A disco solo van los modelos y la configuración.
- **Local por defecto**: sin red tras descargar los modelos. Los adaptadores de nube son opcionales y avisan al usuario.
- **Gestión de modelos**: descarga con reanudación, verificación SHA-256, inventario y borrado desde Ajustes.
- **Ajustes completos**: pares de idiomas, atajos, colores, líneas y modo mover del overlay, rendimiento.
- **Multiplataforma**: Windows, macOS (Intel y Apple Silicon) y Linux.

### Idiomas

| Función | Idiomas |
|---|---|
| OCR y voz a texto | en, es, fr, de, pt, it, ja, zh |
| Traducción | pares Opus-MT del manifiesto (`en↔es`, `en↔fr`, `en↔de`, `en↔it`, `es↔fr`, …) |

La lista vigente está en [crates/tr-models/models.json](crates/tr-models/models.json).

## Motores

| Pieza | Elección |
|---|---|
| Runtime ML | ONNX Runtime vía `ort` |
| OCR | PaddleOCR PP-OCRv6 small (`oar-ocr`) |
| Traducción | Opus-MT (Marian) int8 con caché KV y *beam search* configurable |
| Voz a texto | Whisper base int8 (tiny como alternativa ligera) |
| Captura de pantalla | `xcap` |
| Captura de audio | WASAPI / CoreAudio / PulseAudio-PipeWire |

Las decisiones y las alternativas descartadas están en los [ADR](docs/adr/).

## Arquitectura

```
┌──────────────────────── Electron (TypeScript) ────────────────────────┐
│  Selector · Overlay · Ajustes (Preact) · Bandeja · Atajos             │
│                         │  IPC                                        │
│              utility process  ──  napi-rs (tr-bindings)               │
└─────────────────────────┼─────────────────────────────────────────────┘
                          ▼
   tr-engine   pipeline, modos auto/text/audio, hilos y canales
      │
   tr-core     solo traits y tipos (sin motores)  ◄── fakes en tr-core::testing
      │
   tr-adapters OCR · traducción · STT · captura de pantalla y audio
   tr-models   manifiesto, descarga, inventario y borrado de modelos
```

- **Núcleo en Rust**: workspace con `tr-core`, `tr-adapters`, `tr-models`, `tr-engine` y `tr-bindings`. Hilos y canales, sin `tokio`.
- **Patrón adapter**: `tr-core` solo conoce traits; añadir un motor no modifica el núcleo.
- **UI nunca bloqueada**: el trabajo pesado corre en Rust, en un utility process de Electron (migrable a sidecar sin tocar el núcleo).
- **UI ligera**: electron-vite multipágina; selector y overlay en TS plano + CSS, Ajustes con Preact.

Detalle en [docs/adr/0002-architecture.md](docs/adr/0002-architecture.md).

## Instalación

Descarga el instalador de tu sistema desde la página de [Releases](../../releases):

| Sistema | Archivo | Cómo instalar |
|---|---|---|
| Windows (x64) | `Translate-<versión>-win-x64.exe` | Ejecutar el instalador |
| macOS (Apple Silicon) | `Translate-<versión>-mac-arm64.dmg` | Abrir el `.dmg` y arrastrar a Aplicaciones |
| macOS (Intel) | `Translate-<versión>-mac-x64.dmg` | Igual que arriba |
| Linux (x64) | `.AppImage` o `.deb` | `chmod +x Translate-*.AppImage && ./Translate-*.AppImage`, o `sudo apt install ./Translate-*.deb` |

Los modelos no vienen incluidos: se descargan la primera vez que los necesitas, desde Ajustes.

> **Aviso:** mientras las versiones no estén firmadas, Windows mostrará SmartScreen («Más información» → «Ejecutar de todas formas») y macOS bloqueará la primera apertura (clic derecho → «Abrir»). Ver [docs/release.md](docs/release.md).

## Requisitos para desarrollar

- Rust 1.95+ (`rust-version` del workspace) y toolchain C (`build-essential` en Linux).
- Node.js 22.12+.
- Linux: PulseAudio o PipeWire para el audio; `libgbm` para la captura.

## Puesta en marcha

```bash
# 1. Módulo nativo (napi-rs)
cd crates/tr-bindings && npm ci && npm run build

# 2. App
cd ../../app && npm ci
npm run dev
```

Los modelos no vienen empaquetados: se descargan en el primer uso desde Ajustes. Para descargarlos a mano, por ejemplo para pruebas:

```bash
cargo run --release -p tr-models --example fetch -- ~/.cache/translate-test-models en es all
```

y se indican con `TR_MODELS_DIR=<carpeta>`.

## Pruebas y calidad

```bash
# Rust: formato, lints y tests
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace

# Módulo nativo y app
cd crates/tr-bindings && npm run build:debug && npm test
cd app && npm run typecheck && npm test

# Pruebas con motores y modelos reales
TR_MODELS_DIR=~/.cache/translate-test-models scripts/with-xvfb.sh \
  cargo test --release --workspace -- --include-ignored

# Prueba E2E: ventana → selector → OCR → traducción → overlay
cd app && TR_MODELS_DIR=~/.cache/translate-test-models npm run smoke:e2e
```

Mediciones de rendimiento y presupuestos: [docs/perf/hito-5.md](docs/perf/hito-5.md).

## Empaquetado y releases

`electron-builder` + GitHub Actions generan:

| Plataforma | Artefactos |
|---|---|
| win-x64 | instalador NSIS `.exe` |
| mac-arm64 / mac-x64 | `.dmg` y `.zip` |
| linux-x64 | `.AppImage` y `.deb` |

Un tag `vX.Y.Z` que coincida con `app/package.json` crea una release en borrador. Firma, notarización y pasos manuales en [docs/release.md](docs/release.md).

## Estructura del repositorio

```
crates/        núcleo Rust (core, adapters, models, engine, bindings)
app/           aplicación Electron + TypeScript
docs/adr/      decisiones de arquitectura
docs/perf/     mediciones de rendimiento
docs/validation/  listas de validación manual por hito (Windows/macOS)
openspec/      especificaciones y cambios (Spec-Driven Development)
scripts/       utilidades de CI, empaquetado y pruebas
```

## Hoja de ruta

| Hito | Contenido | Estado |
|---|---|---|
| 1 | Esqueleto: traits, fakes, pipeline, Electron mínimo + napi-rs | ✅ |
| 2 | Texto en pantalla | ✅ |
| 3 | Audio del sistema | ✅ |
| 4 | Fallback texto → audio | ✅ |
| 5 | Pulido: ajustes, modelos, caché, rendimiento | ✅ |
| 6 | Empaquetado y CI | ✅ |

## Contribuir

El proyecto sigue Spec-Driven Development con [OpenSpec](https://github.com/Fission-AI/OpenSpec): se acuerda por escrito qué se construye (`openspec/changes/`) antes de escribir código, un hito por vez y con tests antes de avanzar.

Reglas que no se negocian:

1. Todo en RAM: ningún contenido (captura, audio, texto, traducción) a disco ni a logs.
2. Local por defecto; la nube es opcional y con aviso.
3. `core` solo conoce traits; cada motor es un adaptador.
4. Lo pesado en Rust; la UI nunca se bloquea.
5. Verificar versión y mantenimiento de cada crate antes de añadirlo.

## Licencia

MIT, según `Cargo.toml`.
