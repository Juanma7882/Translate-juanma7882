# Design

## Context

`XcapScreen::grab` (`crates/tr-adapters/src/screen/xcap_screen.rs`) guarda en un `Snapshot` los ids y la geometría de los monitores (refresco cada 5 s), pero en cada captura vuelve a ejecutar `Monitor::all()`, busca el monitor por id y llama a `capture_region`; `xcap` abre una conexión X nueva en cada una. Medido en X11: ~187 ms por captura, independiente del tamaño (ADR 0006). En Windows `Monitor` envuelve un `HMONITOR` y no es `Send`, que `ScreenCapture` exige; por eso se guardan ids. Ver `proposal.md` para la motivación.

Restricciones: `#![forbid(unsafe_code)]` en `tr-adapters` (la API de `xcb` es segura; su `unsafe` interno no cuenta), todo en RAM, el trait `ScreenCapture` y `geometry::plan` no cambian, regla 5 (verificar versión y mantenimiento de la dependencia).

## Goals / Non-Goals

**Goals:**
- Captura de una región en X11 muy por debajo de 187 ms, con conexión y monitores reutilizados.
- Recuperación transparente si la conexión se pierde; mismo reintento acotado y mismos mensajes de error.
- Cero cambios en `tr-engine`, la UI y la API de napi: `XcapScreen::new()` sigue siendo el punto de entrada.

**Non-Goals:**
- Wayland (portal/PipeWire), Windows y macOS: solo se miden, no se reescriben.
- Captura por eventos (Damage) o por memoria compartida (MIT-SHM): posible mejora posterior si `GetImage` no basta.
- Cambiar el intervalo por defecto del bucle.

## Decisions

**1. `XcapScreen` pasa a ser una fachada con dos backends internos.** En Linux, al primer `grab` se intenta el backend X11 propio; si no es una sesión X11 (Wayland, sin `DISPLAY`), si la conexión falla o si el servidor no ofrece un formato soportado, se usa el backend `xcap` actual, sin cambios. Los demás sistemas usan siempre `xcap`. *Alternativa:* un tipo público nuevo (`X11Screen`) elegido en `tr-engine/src/real.rs`; descartada porque obliga a tocar el motor, los tests y `perf` y duplica la lógica de respaldo. La fachada mantiene `XcapScreen::new()` y la feature `screen-xcap`.

**2. Backend X11 con `xcb` (1.7.1, ya en el árbol por `xcap` y como dev-dependency).** Dependencia opcional solo en Linux, activada por `screen-xcap`. Una `xcb::Connection` guardada en el adaptador; cada `grab` hace un `GetImage` (ZPixmap) sobre la ventana raíz con la región ya traducida a coordenadas del escritorio. *Alternativas:* `x11rb` (también segura, pero nueva dependencia sin ventaja sobre una que ya compilamos); parchear o forkear `xcap` para reutilizar la conexión (su API no lo permite, como ya anota el ADR); `scrap`/`libwayshot` (no cubren X11 mejor).

**3. Geometría de monitores con RandR.** Al conectar y cada 5 s (el `REFRESH` actual) se lee `RRGetMonitors`; si el servidor no tiene RandR 1.5, se usa la geometría de la ventana raíz como único monitor. El resultado alimenta `geometry::order`/`geometry::plan` tal cual, así que el índice de monitor y las coordenadas relativas se comportan igual que hoy (incluidos orígenes negativos). Tras cualquier fallo de captura se invalida la geometría y la conexión.

**4. Conversión de píxeles.** `GetImage` devuelve BGRX de 32 bits por píxel con profundidad 24 o 32; se convierte a RGBA con alfa 255 en un buffer del tamaño de la región (el `Frame` ya es RGBA). Formatos distintos (profundidad 16, etc.) se tratan como "no soportado" y activan el respaldo `xcap`. Las regiones muy grandes se piden por franjas de filas para no superar el tamaño máximo de respuesta.

**5. Reintento y reconexión.** Se reutiliza `retry_transient` (3 reintentos, 40 ms): un error de E/S o de conexión descarta la conexión y el siguiente intento reconecta. Un error permanente (región inválida, monitor inexistente) se informa una vez, como hoy. Los mensajes siguen pasando por `describe_failure` (solo causa del sistema, nunca contenido).

**6. Medir primero en las demás plataformas.** `perf capture` se amplía para imprimir la mediana de la captura en cada plataforma; con esas cifras se decide en otro cambio si Windows/macOS lo necesitan. Cachear `Monitor` donde sea `Send` queda condicionado a esa medición, no es un compromiso.

## Risks / Trade-offs

- [`GetImage` copia el frame por el socket X en cada captura; a 1080p son ~8 MB] → La región típica (subtítulo, ~800x150) es pequeña; se mide 1080p y, si no cumple, se estudia MIT-SHM.
- [Dos backends duplican el camino de pruebas] → La suite real `xcap_real.rs` se ejecuta contra ambos (variable que fuerza el respaldo) sobre Xvfb.
- [Un X11 sin RandR o con un formato raro rompe la captura] → Respaldo a la geometría de la raíz y, si el formato no es soportado, a `xcap`.
- [Una conexión persistente puede quedar colgada si el servidor muere] → El error de E/S descarta la conexión; la siguiente captura reconecta y el bucle sigue.
- [`xcb` enlaza `libxcb`] → Ya es requisito de `xcap` en Linux; no hay dependencias nuevas del sistema.

## Migration Plan

Sin migración de datos ni de ajustes. El comportamiento externo no cambia; si algo falla en un entorno, `TR_CAPTURE_BACKEND=xcap` fuerza el respaldo sin recompilar (variable solo de diagnóstico). Rollback: revertir el módulo nuevo y la fachada; el backend `xcap` queda intacto.
