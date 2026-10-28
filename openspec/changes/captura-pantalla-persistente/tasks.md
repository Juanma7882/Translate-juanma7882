# Tasks

## 1. Medición de partida

- [ ] 1.1 Ejecutar `scripts/with-xvfb.sh cargo run --release -p tr-adapters --example perf -- capture` (mediana de 3 ejecuciones) y anotar las cifras actuales de 800x150 y 1280x720; verificar que coinciden con los ~187 ms del ADR
- [ ] 1.2 Verificar versión, mantenimiento y licencia de `xcb` 1.7.1 y que compila con `rust-version = 1.88` (regla 5); dejar el resultado anotado en el ADR 0006

## 2. Backend X11 persistente

- [ ] 2.1 Mover `xcb` a dependencia opcional solo Linux en `crates/tr-adapters/Cargo.toml`, activada por `screen-xcap`, y verificar que `cargo build -p tr-adapters` compila con y sin la feature
- [ ] 2.2 Implementar la lectura de monitores (RandR `GetMonitors`, respaldo a la ventana raíz) con refresco cada 5 s e invalidación tras fallos, alimentando `geometry::order`/`plan`; verificar con pruebas unitarias sobre geometría simulada (origen negativo, monitor inexistente)
- [ ] 2.3 Implementar `GetImage` sobre la raíz con conversión BGRX→RGBA (alfa 255), por franjas de filas para regiones grandes, y rechazo de formatos no soportados; verificar con pruebas unitarias de la conversión y del troceado
- [ ] 2.4 Integrar `retry_transient` y la reconexión (descartar la conexión ante error de E/S o de conexión) manteniendo los mensajes de `describe_failure`; verificar con pruebas que un error transitorio se reintenta y uno permanente se informa una sola vez

## 3. Fachada y respaldo

- [ ] 3.1 Convertir `XcapScreen` en fachada: backend X11 en Linux con sesión X11, respaldo al backend `xcap` actual si falla la conexión, el formato no es soportado o `TR_CAPTURE_BACKEND=xcap`; verificar que `tr-engine` compila sin cambios y que `XcapScreen::new()` sigue sin hacer E/S
- [ ] 3.2 Verificar con una prueba unitaria de la selección que Wayland (`WAYLAND_DISPLAY` definido) y los demás sistemas operativos usan el backend `xcap` sin cambio de comportamiento

## 4. Pruebas reales

- [ ] 4.1 Ejecutar `crates/tr-adapters/tests/xcap_real.rs` sobre Xvfb contra el backend X11 y contra el respaldo (`TR_CAPTURE_BACKEND=xcap`); verificar que ambos pasan los mismos casos (región visible, borde, fuera de límites, monitor inexistente, captura negra)
- [ ] 4.2 Añadir prueba real de reconexión: reiniciar Xvfb entre dos capturas y verificar que la siguiente se completa o informa un error de captura sin cerrar el proceso
- [ ] 4.3 Añadir prueba real de cambio de configuración de monitores (si Xvfb lo permite con RandR) y verificar que las capturas posteriores usan la disposición nueva
- [ ] 4.4 Ejecutar `real_pipeline`, `real_fallback` y `TR_SMOKE=e2e` bajo `scripts/with-xvfb.sh` y verificar que pasan sin cambios

## 5. Rendimiento y documentación

- [ ] 5.1 Ampliar `perf capture` para imprimir también 1080p y la mediana del backend activo (solo números); verificar que la salida no contiene contenido y que el backend X11 queda claramente por debajo de 187 ms
- [ ] 5.2 Medir el ciclo completo con `perf_engine` y anotar el cambio de latencia frame→traducción y de CPU en reposo; verificar que cumple los presupuestos de `docs/perf/hito-5.md`
- [ ] 5.3 Actualizar `docs/perf/hito-5.md` (tabla antes/después, nuevo presupuesto de captura con umbral y comando) y `docs/adr/0006-rendimiento.md` (decisión de la conexión persistente y nota del "Connection error"); verificar que ambos documentos citan las mismas cifras
- [ ] 5.4 Si se dispone de Windows/macOS, correr `perf capture` y anotar la cifra en `docs/validation/windows-hito-5.md`; de lo contrario, anotar "sin medir" y decidir si hace falta un cambio posterior

## 6. Cierre

- [ ] 6.1 Ejecutar `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` y verificar que pasan, incluido el test `no_content_leaks`
- [ ] 6.2 Guardar en Engram la decisión (fachada con respaldo, `xcb`, cifras) y ejecutar `openspec validate captura-pantalla-persistente --strict`
