# Proposal

## Why

La captura de una región con `xcap` en Linux/X11 tarda ~187 ms, igual para 800x150 que para 1280x720 (ADR 0006). Con el intervalo por defecto de 200 ms domina el ciclo: la latencia texto (~400 ms) es casi la mitad captura. La causa está en `XcapScreen::grab`: cada llamada ejecuta `Monitor::all()` (reenumera monitores) y `xcap` abre una conexión X nueva, aunque el adaptador ya guarda la geometría y los ids. Ese coste fijo también obliga al reintento por "Connection error" que hoy se cubre con `retry_transient`.

## What Changes

- En Linux/X11, un adaptador de captura con **conexión X persistente** (`xcb`, API segura, sin `unsafe`): se conecta una vez, lee la geometría de los monitores una vez (con refresco periódico) y cada `grab` solo hace `GetImage` de la región.
- Se reconecta de forma transparente si la conexión se rompe (servidor reiniciado), conservando el reintento acotado ante fallos transitorios.
- Las demás plataformas y las sesiones Wayland siguen con `xcap` sin cambio de comportamiento. En Windows/macOS solo se **mide** (comando `perf capture`) y se documenta; si el coste es relevante, se decide en otro cambio. Si el tipo `Monitor` de `xcap` es `Send` en una plataforma, se evalúa cachearlo en lugar de reenumerar.
- Selección por entorno: `xcb` persistente cuando hay `DISPLAY` X11 y no hay sesión Wayland; si la conexión inicial falla, se usa `xcap` como respaldo.
- Se mantienen el trait `ScreenCapture`, la geometría física (`geometry::plan`), los errores accionables y que todo vive en RAM.
- Se actualizan `docs/adr/0006-rendimiento.md` y `docs/perf/hito-5.md` con las cifras antes/después y un nuevo presupuesto de captura.

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `screen-capture`: la captura en X11 SHALL reutilizar una conexión con el servidor gráfico entre capturas y recuperarse si se pierde; el reintento acotado y los errores descriptivos se conservan.
- `performance-budget`: se añade el presupuesto de latencia de captura de una región en X11.

## Impact

- Código: `crates/tr-adapters/src/screen/` (nuevo módulo `x11_screen.rs` tras una feature, p. ej. `screen-x11`; selección en el módulo `screen`), `crates/tr-adapters/Cargo.toml` (`xcb` pasa de dev-dependency a dependencia opcional solo en Linux), `crates/tr-engine/src/real.rs` (qué adaptador se construye), `crates/tr-adapters/examples/perf.rs` (`capture`).
- Dependencias: `xcb` 1.7.1 (ya en el árbol por `xcap`); verificar versión y mantenimiento antes de promoverla (regla 5). Enlaza `libxcb`, que `xcap` ya exige en Linux.
- Pruebas: `tests/xcap_real.rs` se ejecuta contra ambos adaptadores; nuevas pruebas de reconexión sobre Xvfb.
- Sin impacto en la API de napi ni en la UI. Reglas del proyecto intactas: nada a disco, `forbid(unsafe_code)` se mantiene en `tr-adapters`.
