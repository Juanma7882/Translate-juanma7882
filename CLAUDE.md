# CLAUDE.md — translate

Forma de trabajo global: ver `~/.claude/CLAUDE.md` (SDD con OpenSpec, memoria con codebase-memory + Engram, skills por fase).

## Proyecto

App de escritorio (Windows, macOS, Linux) que traduce texto en pantalla (región → OCR → traducción → overlay) y, si no hay texto, audio del sistema (STT → traducción → subtítulos).

## Stack

- Núcleo: Rust (workspace: `tr-core`, `tr-adapters`, `tr-models`, `tr-engine`, `tr-bindings`). Hilos y canales, sin tokio en el núcleo. Detalle en `docs/adr/0002-architecture.md`.
- Puente: napi-rs, en utility process de Electron (migrable a sidecar sin tocar el núcleo).
- UI: Electron + TypeScript con electron-vite (multi-página). Selector y overlay en TS plano + CSS; Ajustes con Preact. Sin React ni Astro. Razones y plan de crecimiento en `docs/adr/0001-ui-stack.md`.
- Empaquetado: electron-builder + GitHub Actions (win-x64, mac-arm64, mac-x64, linux-x64).

## Reglas no negociables

1. Todo en RAM: nunca escribir capturas, audio, texto ni traducciones a disco (solo modelos y config). Los puertos pasan buffers, no rutas.
2. Local por defecto; adaptadores de nube opcionales y con aviso al usuario.
3. Patrón adapter: `core` solo conoce traits; cada motor es un adaptador. Agregar un motor no modifica `core`.
4. Pesado en Rust; la UI de Electron nunca se bloquea.
5. Verificar versión y mantenimiento de cada crate antes de agregarlo.
6. Un hito por vez, con tests antes de avanzar.

## Hitos

1. Esqueleto (traits, fakes, pipeline, tests; Electron mínimo + napi-rs)
2. Texto en pantalla
3. Audio
4. Fallback texto → audio
5. Pulido (ajustes, modelos, caché, rendimiento)
6. Empaquetado y CI

## Entorno

Desarrollo en WSL (Ubuntu); el repo vive en `~/proyectos/translate`. Se corre todo desde WSL (`wsl -d Ubuntu -- bash <script>`), no desde Git Bash de Windows (convierte rutas `/tmp`).

- Rust: `. ~/.cargo/env` (1.99; el workspace exige `rust-version = 1.88`). Requiere `build-essential`.
- Node 22 en `~/.local/node/bin` (añadido a `~/.profile`). OpenSpec corre con el Node de Windows (`openspec ...` desde PowerShell en la ruta UNC).
- Electron en WSL usa WSLg (`DISPLAY=:0`). Faltaban `libnss3`, `libnspr4` y `libasound2t64`; están extraídas sin root en `~/.local/electron-libs`, así que las pruebas llevan `LD_LIBRARY_PATH=$HOME/.local/electron-libs/usr/lib/x86_64-linux-gnu`. Con `sudo apt install libnss3 libasound2t64` ya no hace falta.
- El `.node` es de Linux: sirve para el Electron de WSL, no para el de Windows. Antes del Hito 2 (captura real) hay que decidir el entorno de desarrollo (ver `openspec/changes/hito-1-esqueleto/design.md`, Open Questions).

## Comandos

```bash
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd crates/tr-bindings && npm run build:debug && npm test      # módulo nativo + tests de Node
cd app && npm run build && TR_SMOKE=1 electron . --no-sandbox   # prueba de humo del shell
```

## Convenciones

- Contenido (texto, audio, traducciones) nunca a disco ni a logs: lints `print_*`/`dbg_macro` en deny, `clippy.toml` con `disallowed-methods`, y el test `no_content_leaks`.
- `#![forbid(unsafe_code)]` en `tr-core` y `tr-engine`.
- Los fakes viven en `tr-core::testing`; el engine con motores de demostración, en `tr-engine::fake`.
- `cargo fmt` reformatea el código: releer antes de editar un archivo que acaba de formatearse.
