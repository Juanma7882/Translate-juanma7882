# Validación manual en Windows y macOS — Hito 4 (fallback texto -> audio)

En WSL se verificó con motores reales: una ventana X con texto se traduce, al retirarla el motor pasa a
audio, una frase reproducida por WSLg se subtitula y al volver el texto regresa a modo texto
(`crates/tr-engine/tests/real_fallback.rs`); y la aplicación Electron completa en modo automático
(`TR_SMOKE=e2e`, bajo Xvfb). Esta lista cubre lo que **solo** se puede comprobar en Windows y macOS: la
captura loopback con el fallback, los atajos globales y la bandeja del sistema reales. Marca cada punto y
anota el resultado.

## Preparación

1. Construir como en `windows-hito-2.md`; modelos de texto y de audio: botón "Descargar modelos" de Ajustes en modo automático (≈ 220 MB en total) o `cargo run --release -p tr-models --example fetch -- <carpeta> en es all`.
2. Pruebas automáticas que deberían pasar: `cargo test --workspace` y `cd app && pnpm test`.
3. Material: un vídeo en inglés con subtítulos incrustados en una zona fija y escenas sin texto; una página con texto.

## 1. Modo automático (fallback)

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 1.1 | Elegir una región con texto en inglés con el modo en "Automático" | Se traduce el texto; el overlay muestra la etiqueta "Texto" |
| 1.2 | Cambiar la región a una zona sin texto (o cerrar la ventana de origen) | Tras 3 s (o los segundos de Ajustes) el overlay cambia a "Audio" y, con un vídeo sonando, aparecen subtítulos traducidos |
| 1.3 | Volver a poner texto en la región | Tras ~1 s vuelve a "Texto" y el texto se traduce de nuevo |
| 1.4 | Texto que parpadea (animación, cursor, menús que aparecen y desaparecen) | El modo no oscila entre texto y audio; anotar falsos cambios |
| 1.5 | Cambiar "Pasar a audio tras" a 10 s con la sesión en marcha | La sesión se reinicia y respeta la nueva espera |
| 1.6 | Pausar en modo audio y reanudar | En pausa no hay subtítulos; al reanudar vuelven en el mismo modo |
| 1.7 | Loopback WASAPI (Windows) y tap de CoreAudio (macOS) mientras el modo pasa de texto a audio y vuelta 10 veces | Sin errores de captura ni fugas de hilos; el uso de memoria no crece |

## 2. Modos forzados y atajo

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 2.1 | Atajo global de modo (`Ctrl+Shift+M` / `Cmd+Shift+M`) con la sesión en marcha | Cicla Automático -> Solo texto -> Solo audio y la etiqueta del overlay y el tooltip de la bandeja cambian |
| 2.2 | Atajo ocupado por otra aplicación (cambiar el atajo en Ajustes a uno ya usado) | Aviso que nombra el atajo y dice que se cambia en Ajustes |
| 2.3 | Submenú "Modo" de la bandeja (clic derecho en Windows, menú de la barra en macOS) | La opción activa está marcada; elegir otra reinicia la sesión en ese modo |
| 2.4 | Solo audio sin haber elegido nunca una región | "Traducir la última región" está habilitado y arranca sin abrir el selector |
| 2.5 | Solo texto con la región sin texto | Nunca pasa a audio, ni siquiera tras minutos |
| 2.6 | Cambiar de modo 20 veces seguidas con el atajo | El overlay no se cierra ni parpadea; sin hilos colgados |

## 3. Primer uso

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 3.1 | Instalación limpia, modo Automático, elegir región | Aviso con todos los modelos que faltan (texto y audio), se abre Ajustes con el tamaño total y la nota de internet |
| 3.2 | Descargar solo los de audio | No se inicia la traducción (faltan los de texto) |
| 3.3 | Terminar la descarga de lo que falta | La traducción pendiente arranca sola |
| 3.4 | Primer uso en "Solo texto" | Solo se piden los modelos de texto |

## 4. Rendimiento y recursos

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 4.1 | Memoria del motor en automático con los modelos cargados (Administrador de tareas / Monitor de actividad) | Anotar MB: OCR + Whisper base + traductor (compartido) |
| 4.2 | Tiempo hasta la primera traducción tras elegir la región | Anotar segundos; si supera ~20 s, considerar carga perezosa de la voz (Hito 5) |
| 4.3 | CPU en modo audio con la región vigilada a baja frecuencia | Sin saturar un núcleo de forma sostenida cuando no suena nada |

## 5. Privacidad

| # | Qué comprobar | Resultado esperado |
|---|---|---|
| 5.1 | Durante una sesión con cambios de modo, vigilar la escritura a disco (Process Monitor / `fs_usage`) | Solo `settings.json` al cambiar de modo o de ajustes; ni capturas, ni audio, ni textos |
| 5.2 | La etiqueta del overlay | Solo contiene "Texto", "Audio" o "Pausa" |
