# Tasks

## 1. Spike y decisión

- [x] 1.1 Verificar versión, licencia y mantenimiento de `realfft`, `cpal` y `pulseaudio` (y comprobar que `cpal` exige ALSA en Linux) y fijarlas con `=` en `[workspace.dependencies]`; verificar que `cargo build` sigue compilando sin paquetes `-dev` adicionales
- [x] 1.2 Spike de STT: Whisper tiny y base int8 con `ort` sobre dos WAV sintetizados (inglés y español); registrar latencia por ventana de 2 s, tamaños y SHA-256 de los archivos, y verificar que el texto es correcto
- [x] 1.3 Escribir `docs/adr/0004-audio-stt.md` con la decisión de STT y de captura por plataforma, mediciones y descartes (`whisper-rs`, `cpal` en Linux)

## 2. tr-core y tr-models

- [x] 2.1 Añadir `SpeechToText::push_window` con implementación por defecto y usarlo desde `AudioProcessor::send_window`; verificar que los tests de `tr-core` existentes siguen pasando y añadir un test de que la última ventana de una intervención va marcada como de cierre
- [x] 2.2 Ampliar el manifiesto con la tabla `stt`, `stt_model`, `required_for_audio`, `required_for_all` y `stt_languages`, y añadir `stt-whisper-base` y `stt-whisper-tiny` a `models.json`; verificar con tests: modelos de audio de un par, idioma sin modelo, manifiesto sin tabla `stt` válido, archivos bien formados
- [x] 2.3 Descargar los modelos reales con el ejemplo `fetch` (ámbito `audio`) y verificar que las huellas del manifiesto coinciden

## 3. tr-adapters: reconocimiento de voz

- [x] 3.1 Feature `stt-whisper`; implementar el log-mel (`mel.rs`) y verificar con tests: tamaño fijo, silencio plano, rango dinámico, un tono ilumina su banda mel
- [x] 3.2 Implementar el tokenizador byte-level (`tokenizer.rs`) y verificar con tests: alfabeto de bytes, caracteres partidos entre piezas, tokens especiales, idiomas por subetiqueta, vocabulario inválido
- [x] 3.3 Implementar `Utterance` (acumulación parcial -> final, cierre a los 8 s, normalización de espacios) y verificar con tests de tabla
- [x] 3.4 Implementar `WhisperStt` (encoder, decoder con caché KV, supresión de tokens, bucles, no-habla, anotaciones) y verificar con tests unitarios de las funciones puras y con carga de carpeta ausente o incompleta
- [x] 3.5 Test real ignorado (`stt_real`) con los WAV de prueba: inglés y español transcritos, silencio y ruido sin texto, ventanas consecutivas con parcial y final, ventana de 2 s por debajo de 2 s e idioma no soportado rechazado

## 4. tr-adapters: captura del audio del sistema

- [x] 4.1 Implementar `to_mono`, `Resampler` y `Chunker` y verificar con tests: mezcla, tono 1 kHz conservado a 48/44,1/32/96 kHz, 12 kHz atenuado, resultado independiente de cómo se parta la entrada, memoria acotada
- [x] 4.2 Implementar `PulseLoopback` (Linux) y verificar con tests contra el servidor real (WSLg): trozos de 100 ms consecutivos, detener sin más trozos, reinicio, arrancar dos veces es error, sin servidor es un error de captura
- [x] 4.3 Implementar `CpalLoopback` (Windows/macOS) y verificar que compila con `cargo check --target x86_64-pc-windows-gnu`
- [x] 4.4 Verificar que los análisis de escritura a disco y de impresión cubren los módulos nuevos de `tr-adapters` (`print_*`, `disallowed-methods`)

## 5. tr-engine y bindings

- [x] 5.1 Añadir features `stt-whisper` y `audio-loopback` y `real::audio_parts` (compilado, idiomas, modelos listos y solo entonces carga y captura); sustituir el error "not available yet" y actualizar sus tests: modelos de audio ausentes listados sin OCR, idioma no soportado, motor no compilado
- [x] 5.2 Añadir `ModelScope`, `status_for`, `download_for` y `Catalog::stt_languages` y verificar con tests de servicio de modelos
- [x] 5.3 Test de punta a punta real ignorado (`real_audio`): reproducir una frase por la salida del servidor de sonido y verificar que el motor emite un subtítulo final traducido sin errores
- [x] 5.4 Binding: parámetro `scope` en `modelStatus`/`downloadModels` y `sttLanguages` en `modelCatalog`; actualizar `api.js`, `api.d.ts` y los tests de Node (audio real sin modelos lista los faltantes; ámbito inválido es `InvalidArg`)

## 6. App (mínimo) y validación

- [x] 6.1 Ajustes: mostrar estado y descarga de los modelos de audio con el ámbito `audio`, sin rediseño; verificar con `npm run typecheck` y `npm test`
- [x] 6.2 Escribir `docs/validation/windows-hito-3.md` con la validación manual de la captura loopback (Windows y macOS) y de la calidad de voz
- [x] 6.3 Verificar `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, tests de Node del binding y `cd app && npm run typecheck && npm test`
- [x] 6.4 Guardar decisiones en Engram y actualizar `CLAUDE.md` con una edición mínima (comandos y entorno de audio)
