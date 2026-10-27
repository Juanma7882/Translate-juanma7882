# Tasks

## 1. Entorno y workspace

- [x] 1.1 Instalar Node 22 en WSL con nvm (sin sudo) y verificar que `node --version` y `npm --version` responden dentro de WSL
- [x] 1.2 Verificar versión y mantenimiento de `thiserror`, `crossbeam-channel` y `lru` y registrar las versiones elegidas en el ADR o en `Cargo.toml` comentado
- [x] 1.3 Crear el workspace (`Cargo.toml` raíz, `crates/tr-core`, `crates/tr-engine`, `crates/tr-bindings`) y verificar que `cargo build --workspace` compila
- [x] 1.4 Agregar `clippy.toml` con `disallowed-methods` para escritura a disco y verificar que `cargo clippy --workspace -- -D warnings` pasa, y que un `File::create` de prueba lo hace fallar (revertir la prueba)

## 2. tr-core: tipos, errores y puertos

- [x] 2.1 Definir `Region`, `Frame`, `TextBlock`, `AudioChunk`, `Segment`, `Lang` y `Event`, con tests de construcción y validación (región vacía, idioma desconocido)
- [x] 2.2 Definir `CoreError` por categoría con `thiserror` y verificar con un test que cada categoría se convierte en evento de error
- [x] 2.3 Definir los traits `ScreenCapture`, `OcrEngine`, `AudioCapture`, `SpeechToText`, `Translator`, `EventSink` y `Clock` y verificar que `tr-core` compila sin depender de ningún motor
- [x] 2.4 Implementar los fakes (`FakeScreen`, `FakeOcr`, `FakeAudio`, `FakeStt`, `FakeTranslator`, `FakeClock`, `RecordingSink`) con respuestas, latencias y fallos programables; verificar con tests unitarios de cada fake

## 3. tr-core: utilidades de pipeline

- [x] 3.1 Implementar `LatestSlot<T>` ("último gana") y verificar con tests que el consumidor siempre recibe el valor más reciente y que el productor nunca se bloquea
- [x] 3.2 Implementar la detección de cambio entre frames (cuadrícula en grises + diferencia media) y verificar con frames sintéticos: idénticos, ruido bajo el umbral, cambio sobre el umbral
- [x] 3.3 Implementar normalización de texto y estabilización (N=2 frames) y verificar con tests de texto cambiante, estable y vacío
- [x] 3.4 Implementar la caché LRU de traducciones y verificar acierto, desalojo por capacidad y claves por par de idiomas

## 4. tr-core: pipelines

- [x] 4.1 Implementar `RegionPipeline` y verificar con fakes: texto nuevo emite traducción; frames idénticos invocan al OCR una vez; texto repetido no invoca al traductor; backpressure procesa solo el frame más reciente
- [x] 4.2 Verificar en `RegionPipeline` los caminos de error (fallo de captura, OCR o traducción emite `onError` y el pipeline continúa) y la detención sin eventos posteriores
- [x] 4.3 Implementar VAD por energía y ventanas con solape y verificar con audio sintético: silencio no invoca STT, habla sí, palabra en el límite aparece una vez
- [x] 4.4 Implementar `AudioPipeline` y verificar con fakes: parciales sin traducir, final traducido, liberación de búferes al detener
- [x] 4.5 Implementar la state machine pura `step` (Text, Audio, Paused) y verificar con `FakeClock`: paso a audio tras 3 s sin texto, regreso a texto, histéresis ante texto intermitente, pausa y reanudación al modo previo
- [x] 4.6 Implementar `TextOrAudioPipeline` que ejecuta las acciones de la state machine y verificar con un test de integración con fakes que el audio solo se captura en modo audio
- [x] 4.7 Agregar un test que captura los logs durante una ejecución completa y verifica que no contienen texto, audio ni traducciones, y que no se crean archivos

## 5. tr-engine

- [x] 5.1 Implementar `Engine::new(config, sink)` con `engines = Fake` que cablea los fakes, y verificar con un test de integración que `start_region` -> eventos -> `stop` funciona de punta a punta
- [x] 5.2 Verificar en `tr-engine` el arranque y la detención repetidos (start/stop/start) sin hilos ni recursos colgados

## 6. tr-bindings (napi-rs)

- [x] 6.1 Verificar versión y mantenimiento de `napi`, `napi-derive` y `@napi-rs/cli`, fijarlas y verificar que el módulo vacío compila a `.node`
- [x] 6.2 Exponer `startRegionTranslation`, `startAudioSubtitles` y `stop` con validación de argumentos y verificar con un script de Node que argumentos inválidos fallan con error descriptivo
- [x] 6.3 Exponer los eventos `onTranslation`, `onSubtitle`, `onError` y `onModelProgress` con `ThreadsafeFunction` y verificar con un script de Node que se reciben eventos con motores falsos y que dejan de llegar tras `stop`
- [x] 6.4 Instalar el hook de pánico que no registra el payload y verificar con un test que un pánico forzado no imprime el mensaje original
- [x] 6.5 Verificar que el hilo de JS sigue respondiendo con un motor falso lento (test de Node con temporizador)
- [x] 6.6 Generar los tipos de TypeScript del binding y verificar que se importan sin errores desde `app/`

## 7. Electron mínimo (electron-vite)

- [x] 7.1 Crear `app/` con electron-vite + TypeScript (main y preload, sin renderers de producto) y verificar que `npm run build` termina sin errores
- [x] 7.2 Implementar el utility process que carga el `.node` y reenvía comandos y eventos por mensajes, y verificar con un script que un evento de traducción llega al proceso principal
- [x] 7.3 Implementar la supervisión (detectar salida inesperada, notificar sin contenido, reiniciar con backoff) y verificar con un test que fuerza la caída del utility process y comprueba que main sigue vivo y reinicia
- [x] 7.4 Crear el script de humo (arrancar la app, iniciar traducción con fakes, esperar un evento, salir con 0 o 1) y verificar que pasa en WSL con WSLg o xvfb

## 8. Cierre del hito

- [x] 8.1 Ejecutar `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` y el script de humo, y verificar que todo pasa
- [x] 8.2 Actualizar `CLAUDE.md` y los ADR si cambió algo, guardar decisiones y aprendizajes del hito en Engram y re-indexar codebase-memory
