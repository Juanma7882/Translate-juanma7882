# Tasks

## 1. Prerrequisitos y spikes

- [x] 1.1 Pedir al usuario que ejecute `sudo apt install -y pkg-config libclang-dev libxcb1-dev libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev` y verificar con `pkg-config --exists xcb xrandr dbus-1 libpipewire-0.3` (si no se puede, pasar a modo "adaptador tras feature flag" y avisar)
- [x] 1.2 Verificar versión, licencia y mantenimiento de `oar-ocr`, `ort` (=2.0.0-rc.13), `xcap`, `tokenizers`, `ureq`, `sha2`, `serde`, `serde_json`, `image`, y de Preact y su preset de Vite; fijarlas en `[workspace.dependencies]` y `package.json` y subir `rust-version` a lo que exijan; verificar que `cargo build --workspace` sigue compilando
- [x] 1.3 Spike de OCR fuera del workspace (directorio de scratch): cargar PP-OCR (det+rec+diccionario) con `oar-ocr`/`ort` y reconocer una imagen de prueba en inglés y otra en japonés; registrar latencia, URLs, tamaños y SHA-256 de cada archivo y verificar que reconoce el texto esperado
- [x] 1.4 Spike de traducción fuera del workspace: encoder+decoder de `Xenova/opus-mt-en-es` int8 con `ort` y `tokenizers`, decodificación voraz acotada; traducir 5 frases de prueba y verificar que son correctas; registrar latencia y SHA-256 de los archivos; repetir con `es-en`
- [x] 1.5 Escribir `docs/adr/0003-ocr-translation-engines.md` con resultados y decisiones de los spikes; si un spike falló, detener y consultar al usuario antes de aplicar el respaldo (ocrs / ct2rs)

## 2. tr-models

- [x] 2.1 Crear `crates/tr-models` con el `#![allow(clippy::disallowed_methods)]` justificado y verificar que `cargo clippy --workspace --all-targets -- -D warnings` pasa y que el escáner `no_content_leaks` sigue excluyendo solo a este crate
- [x] 2.2 Implementar el manifiesto (`models.json` embebido, tipos con `serde`, tablas por idioma de OCR y por par de traducción, con los datos reales del spike) y verificar con tests: parseo, modelos de `en->es`, idioma y par no soportados, SHA-256 de 64 hex y URLs `https`
- [x] 2.3 Implementar el descargador (`ureq`, archivo `.part`, SHA-256 en streaming, `rename` atómico, callback de progreso) y verificar con tests contra un servidor HTTP local: éxito con progreso creciente, huella distinta (se descarta y no queda archivo), HTTP 404/500, conexión cortada (no queda archivo válido) y escritura solo dentro de la carpeta de modelos
- [x] 2.4 Implementar `ModelManager` (estado `Missing/Downloading/Ready`, `ensure(par)` idempotente, caché de verificación por tamaño y fecha, carpeta por defecto del SO y configurable) y verificar con tests: modelo íntegro = listo, archivo corrupto = ausente y se redescarga, ya listo = sin descarga, funcionamiento sin red
- [x] 2.5 Verificar que el escáner de APIs de escritura se amplía a `tr-adapters` y falla si un adaptador usa `File::create`, `fs::write` u `OpenOptions` (prueba de mutación temporal)

## 3. tr-adapters: captura de pantalla

- [x] 3.1 Crear `crates/tr-adapters` con features `screen-xcap`, `ocr-paddle`, `translate-opus` y verificar que compila con todas, con cada una sola y sin ninguna
- [x] 3.2 Implementar la resolución de monitor y la conversión de coordenadas (puras, sin `xcap`) y verificar con tests de tabla: monitor principal, segundo monitor, origen negativo, región fuera de límites (recorte o error) y monitor inexistente
- [x] 3.3 Implementar `XcapScreen` (`ScreenCapture`) con `capture_region`, mapeo de errores a `CoreError::Capture` con mensajes accionables y detección de Wayland; verificar con tests de mapeo de errores y que un frame negro se devuelve sin error
- [x] 3.4 Test de integración con captura real en X11/WSLg: una ventana con un patrón de color conocido y verificar que la región capturada coincide en tamaño y color (ignorado sin `DISPLAY`)

## 4. tr-adapters: OCR

- [x] 4.1 Implementar `PaddleOcr` (`OcrEngine`) sobre `oar-ocr`/`ort` cargando det+rec+diccionario desde la carpeta de modelos, devolviendo `TextBlock` con caja, confianza y orden de lectura; verificar con tests de la conversión de resultados y de errores (modelos ausentes, idioma no soportado)
- [x] 4.2 Verificar que el adaptador no escribe a disco ni a registros (escáner ampliado) y que no hay red en su ruta de ejecución
- [x] 4.3 Test de integración con modelos reales (`TR_REAL_MODELS=1`): una imagen con una frase en inglés devuelve esa frase, una imagen sin texto devuelve lista vacía, y una frase en japonés se reconoce con el conjunto CJK; medir latencia

## 5. tr-adapters: traducción

- [x] 5.1 Implementar `OpusMt` (`Translator`): tokenización, encoder, bucle del decoder con caché, decodificación voraz con longitud máxima, sesiones tras `Mutex`; verificar con tests de las piezas puras (preparación de entrada, corte por token final y por longitud máxima, detección de repetición)
- [x] 5.2 Implementar el registro de pares y los errores (par no soportado, modelos ausentes) y verificar con tests; texto vacío devuelve vacío sin cargar el modelo
- [x] 5.3 Test de integración con modelos reales (`TR_REAL_MODELS=1`): 5 frases `en->es` y 5 `es->en` con resultados esperados, entrada larga que termina en tiempo acotado, y dos hilos traduciendo a la vez sin mezclar resultados

## 6. tr-engine y puente

- [x] 6.1 Añadir `EngineKind::Real`, `models_dir` y la fábrica de adaptadores reales en `tr-engine` (verificación de modelos antes de arrancar, error que lista los ausentes, sin capturar si faltan); verificar con tests usando modelos de mentira en una carpeta temporal y con motores de demostración intactos
- [x] 6.2 Exponer el progreso de descarga como `Event::ModelProgress` y los comandos `model_status` / `download_models` en `tr-engine` (descarga en hilo propio, cancelable al parar); verificar con tests contra el servidor HTTP local
- [x] 6.3 Verificar de punta a punta en Rust (`TR_REAL_MODELS=1`, X11/WSLg): la captura real de una ventana con texto conocido produce un evento de traducción con el texto esperado
- [x] 6.4 Exponer en `tr-bindings` y `api.js`: `configure({ engines, modelsDir })`, `pause()`, `resume()`, `modelStatus(from, to)`, `downloadModels(from, to)`; verificar con tests de Node: motores no soportados rechazados sin cambiar la configuración, pausa sin nada en marcha, estado y descarga contra un servidor local con progreso creciente, par no soportado
- [x] 6.5 Actualizar `api.d.ts` y los tipos generados y verificar que `app/` los importa sin errores de TypeScript

## 7. Electron: infraestructura de ventanas

- [x] 7.1 Implementar el almacén de ajustes (`settings.json` en `userData`, esquema validado a mano con versión y valores por defecto, archivo dañado → defecto + aviso, última región) y verificar con tests de Node: valores por defecto, ida y vuelta, archivo dañado, versión desconocida
- [x] 7.2 Configurar `electron-vite` con tres renderers (selector, overlay, ajustes), un preload con API tipada mínima por ventana, `contextIsolation`/`sandbox` activados y CSP estricta; verificar que `npm run build` y `npm run typecheck` pasan y que un test abre cada ventana y comprueba que `require`/`process` no existen en su contexto
- [x] 7.3 Implementar el gestor de ventanas (crear/destruir selector, overlay y ajustes; solo una instancia de cada una) y verificar con la prueba de humo que se abren y se cierran sin dejar procesos ni ventanas

## 8. Selector de región

- [x] 8.1 Implementar `toPhysicalRegion` en `shared/` y verificar con tests de tabla: escalas 1.0, 1.25, 1.5 y 2.0, monitor con origen negativo, región en el segundo monitor y región mínima rechazada
- [x] 8.2 Implementar el selector (TS plano + CSS): arrastre, Escape cancela, soltar confirma, clic sin arrastre ignorado, región anterior como punto de partida, sin captura de fondo; verificar con una prueba que simula la interacción por la ventana real y comprueba la región devuelta
- [x] 8.3 Conectar selector → ajustes (guardar última región) → inicio de la traducción y verificar con la prueba de humo que una región confirmada inicia la traducción y se recupera tras reiniciar la app

## 9. Overlay

- [x] 9.1 Implementar `placeOutside(region, display, size)` y verificar con tests de tabla: cabe debajo, no cabe debajo y va encima, región que ocupa casi toda la pantalla, segundo monitor
- [x] 9.2 Implementar la ventana del overlay (transparente, encima, sin foco, clic a través, exclusión de captura donde exista, sin barra de tareas) y verificar por consulta a la ventana real las propiedades que WSLg permita comprobar; dejar las demás en la lista de verificación de Windows
- [x] 9.3 Implementar el renderer del overlay (original + traducción, subtítulos parciales con estilo provisional, ocultar tras N segundos, apariencia por variables CSS con cambios en vivo, actualización con `textContent`) y verificar con una prueba que envía eventos y lee el DOM de la ventana real
- [x] 9.4 Verificar que el overlay no guarda texto en disco ni en registros (revisión del código y prueba que ejecuta una sesión y compara el contenido de la carpeta de datos de la app antes y después)

## 10. Ventana de Ajustes (Preact)

- [x] 10.1 Añadir Preact y su preset de Vite con versiones verificadas y verificar que el build de la ventana de Ajustes pasa sin afectar a las otras ventanas
- [x] 10.2 Implementar el estado y las validaciones de Ajustes como lógica pura (idiomas distintos, motores, apariencia) y verificar con tests de Node
- [x] 10.3 Implementar la interfaz: idiomas, motores, apariencia con vista previa, estado de modelos y descarga con barra de progreso y reintento, etiquetas y orden de tabulación; verificar con una prueba sobre la ventana real que cambiar un ajuste lo persiste y lo aplica al overlay
- [x] 10.4 Verificar la gestión de modelos desde la interfaz contra un servidor local: progreso que avanza, error con reintento y estado final listo

## 11. Integración: bandeja, atajos y primer uso

- [x] 11.1 Implementar el icono de bandeja con menú (elegir región, pausar/reanudar, ajustes, salir) y verificar con una prueba que invoca las acciones del menú y comprueba pausa/reanudación del motor
- [x] 11.2 Implementar atajos globales configurables con informe de conflicto y verificar con una prueba que simula un registro fallido y comprueba el aviso; el comportamiento real del atajo se anota en la lista de verificación de Windows
- [x] 11.3 Implementar el flujo de primer uso (detectar modelos ausentes, aviso de descarga desde internet con tamaño total, progreso, continuar al terminar) y verificar con una prueba contra servidor local
- [x] 11.4 Mostrar los errores del motor (captura, OCR, traducción, modelos) como avisos comprensibles sin contenido y verificar con pruebas que inyectan cada categoría de error
- [x] 11.5 Prueba E2E con motores reales en WSLg (`TR_REAL_MODELS=1`): una ventana de la app muestra un texto conocido, el selector devuelve su región, el motor captura, reconoce y traduce, y el DOM del overlay contiene la traducción esperada

## 12. Validación y cierre

- [x] 12.1 Escribir `docs/validation/windows-hito-2.md` con la lista de verificación manual para Windows: captura real, DPI/escala, monitores múltiples, overlay (clic a través, siempre encima, exclusión de captura), atajos globales, juegos en ventana sin bordes, DRM y descarga de modelos, indicando qué comprobar y el resultado esperado
- [x] 12.2 Ejecutar `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (con y sin `TR_REAL_MODELS=1`), los tests de Node, `typecheck`, `build` y las pruebas de humo, y verificar que todo pasa
- [x] 12.3 Actualizar `CLAUDE.md`, los ADR y el design si cambió algo, guardar decisiones y aprendizajes en Engram y re-indexar codebase-memory
