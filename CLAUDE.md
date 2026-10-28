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
- El `.node` es de Linux: sirve para el Electron de WSL, no para el de Windows. Decisión: desarrollar en WSL y validar en Windows con `docs/validation/windows-hito-2.md` (lista manual por hito).
- Captura real: bajo WSLg (Wayland) `xcap` no puede capturar. Se prueba sobre Xvfb con `scripts/with-xvfb.sh <comando>` (usa el Xvfb del sistema o el extraído en `~/.local/xvfb`; con `sudo apt install xvfb libgbm-dev` desaparecen los apaños).
- `xcap` enlaza `-lgbm`: hay un symlink en `~/.local/lib`, de ahí `export LIBRARY_PATH=$HOME/.local/lib:$LIBRARY_PATH` al compilar (y `LD_LIBRARY_PATH` con esa carpeta al ejecutar).
- Modelos reales para pruebas: `cargo run --release -p tr-models --example fetch -- ~/.cache/translate-test-models en es` (y `es en`); se pasan con `TR_MODELS_DIR`.
- Audio (Hito 3): la captura de Linux habla con PulseAudio/PipeWire en Rust puro (WSLg sirve: `PULSE_SERVER=unix:/mnt/wslg/PulseServer`). Modelos: `fetch -- <carpeta> en es audio`; tests reales: `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-adapters --test stt_real -- --ignored --test-threads=1`, `-p tr-adapters --test audio_real -- --ignored` y `-p tr-engine --test real_audio -- --ignored`. Windows/macOS: `docs/validation/windows-hito-3.md`; decisiones en `docs/adr/0004-audio-stt.md`.
- Fallback (Hito 4): modos `auto`/`text`/`audio` en Ajustes (por defecto `auto`, necesita modelos de texto y de audio: `fetch -- <carpeta> en es all`). Test real: `TR_MODELS_DIR=<carpeta> scripts/with-xvfb.sh cargo test --release -p tr-engine --test real_fallback -- --ignored`; smoke de la app completa en automático: `TR_SMOKE=e2e` bajo `scripts/with-xvfb.sh`. Windows/macOS: `docs/validation/windows-hito-4.md`; decisiones en `docs/adr/0005-fallback.md`.
- Gestión de modelos y ajustes (Hito 5B): inventario/borrado/cancelar/reanudar (`Range`) y carpeta validada en `tr-models` (único que borra disco, solo ids del manifiesto), pares extra en `models.json` (prueba real: `TR_MODELS_DIR=<carpeta> cargo test --release -p tr-engine --test real_pairs -- --ignored`), Ajustes en pestañas, overlay con colores/líneas/modo mover y `EngineOptions.performance` (enganche para 5A). Decisiones en `docs/adr/0007-gestion-modelos.md`; Windows/macOS: `docs/validation/windows-hito-5.md`.
- Para comprobar que algo funciona sin red: `unshare -rn <comando>`.

## Comandos

```bash
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
# con motores y modelos reales (captura sobre Xvfb):
TR_MODELS_DIR=~/.cache/translate-test-models scripts/with-xvfb.sh cargo test --release --workspace -- --include-ignored
cd crates/tr-bindings && pnpm run build:debug && pnpm test      # módulo nativo + tests de Node (pnpm run build = release)
cd app && pnpm run typecheck && pnpm test                        # tipos + tests unitarios (node --test sobre TS)
cd app && pnpm run build && TR_SMOKE=<1|windows|selector|flow|overlay|settings|shell> electron . --no-sandbox   # pruebas de humo
cargo run --release -p tr-adapters --example perf -- <mt|ocr|stt|audio|frame|capture>   # mediciones (solo números); método y presupuestos en docs/perf/hito-5.md
scripts/verify-package.sh   # empaquetado linux-x64 (dir) + TR_SMOKE=1 con el .node empaquetado; ver docs/release.md
cd app && TR_MODELS_DIR=~/.cache/translate-test-models pnpm run smoke:e2e   # E2E real: ventana -> selector -> OCR -> traducción -> overlay
```

## Convenciones

- Contenido (texto, audio, traducciones) nunca a disco ni a logs: lints `print_*`/`dbg_macro` en deny, `clippy.toml` con `disallowed-methods`, y el test `no_content_leaks`.
- `#![forbid(unsafe_code)]` en `tr-core` y `tr-engine`.
- Los preloads de Electron (sandbox) deben ser un único archivo autocontenido: solo `import type` y `satisfies typeof Channel.x` (nada de módulos compartidos; `isolatedEntries` de electron-vite falla sin TTY).
- Los eventos del motor llegan por dos canales (promesa de `AsyncTask` y `ThreadsafeFunction`): `api.js` asienta el progreso (`settleProgress`) antes de resolver una descarga.
- `AppShell` recibe bandeja, atajos y notificaciones por inyección: así se prueba sin WSLg.
- Los fakes viven en `tr-core::testing`; el engine con motores de demostración, en `tr-engine::fake`.
- `cargo fmt` reformatea el código: releer antes de editar un archivo que acaba de formatearse.
