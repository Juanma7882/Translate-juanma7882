# ADR 0005 — Modos y fallback texto -> audio en la aplicación

- Estado: aceptado
- Fecha: 2026-10-27
- Contexto: Hito 4 (`openspec/changes/hito-4-fallback`). El núcleo ya tenía la máquina de estados del fallback (`tr-core::fallback`) y el motor sabía armarla con motores reales; faltaba cómo el usuario elige y alterna de modo, cómo se ve y cómo se hace el primer uso con los modelos de audio.

## Decisión

| Tema | Elección |
|---|---|
| Modo | Ajuste `mode`: `auto` (por defecto), `text` o `audio`. La app decide la orden al motor; el núcleo no conoce "modo elegido" |
| Órdenes | auto = `startRegion` + `autoFallback`; texto = `startRegion` sin fallback; audio = `startAudio` (sin región) |
| Alternar en caliente | Cambiar `mode` (atajo `toggleMode`, submenú de la bandeja o Ajustes) reinicia la sesión con `configure` + nueva orden; el overlay no se cierra |
| Atajo | `toggleMode` cicla auto -> texto -> audio -> auto (por defecto `CommandOrControl+Shift+M`); el menú ofrece elección directa |
| Modo activo | `AppState.mode` (`text`/`audio`/`null`). En auto lo marca el evento `mode` del núcleo; en los forzados lo fija el controlador. La pausa conserva el modo |
| Pausa en solo audio | El motor solo pausa sesiones de región; en solo audio la pausa detiene la captura y reanudar vuelve a arrancarla |
| Espera | `fallbackSeconds` (1-60, 3 por defecto) -> `no_text_for`; el regreso a texto sigue en 1 s (`text_for`) |
| Indicador | Etiqueta en el overlay (canal `overlay:mode`, solo el nombre del modo); al cambiar de modo se borra el texto anterior y se muestra la etiqueta unos segundos |
| Traductor | Texto y audio comparten una instancia (no se carga dos veces el modelo de ~110 MB) |
| Modelos | Con fallback real, `Engine::start_region` comprueba texto **y** audio antes de construir nada y lista los faltantes juntos. La app pide por ámbito (`scopeForMode`: texto -> `text`, audio -> `audio`, auto -> `all`) y solo reintenta tras una descarga cuando el ámbito del modo está completo |
| Arranque lento | `startRegion`/`startAudio` cargan los modelos en la orden: tienen un plazo de 120 s en lugar de los 10 s del resto de órdenes (medido: el arranque en automático con modelos reales no cabía en 10 s) |

## Por qué

- **El modo vive en los ajustes y no en el motor**: el motor ya sabe hacer las tres cosas con la API existente, así que no cambia el puente ni el núcleo y el estado del modo sobrevive a reinicios del motor tras una caída.
- **Reiniciar la sesión al cambiar de modo** es simple y robusto (no hay estados intermedios entre pipelines); el coste es perder caché y estabilizador, aceptable porque es una acción manual y poco frecuente.
- **Histéresis ya resuelta en el núcleo**: `step` exige 3 s sin texto para pasar a audio y 1 s con texto para volver; se añadieron pruebas con tiempos sintéticos (texto intermitente durante 60 s sin ningún cambio, umbrales configurables) en lugar de depender de relojes reales.
- **Eventos de modo solo del fallback**: emitirlos desde los pipelines simples cambiaría el contrato de los tests existentes (un motor en texto sin eventos extra) sin aportar nada, porque la app conoce el modo por la orden que dio.

## Alternativas descartadas

- Un `startSession(mode)` nuevo en el binding: duplica lo que ya dan `autoFallback` y `startAudio` y obliga a mantener otra API.
- Cambiar de modo sin reiniciar (pipeline único con modo mutable): más piezas con estado compartido para un beneficio nulo en la práctica.
- Degradar el modo automático a solo texto si faltan los modelos de audio: oculta un fallo de configuración; se prefiere avisar y ofrecer la descarga.

## Consecuencias

- En modo automático el consumo de memoria incluye OCR, voz y traducción a la vez (ver mediciones en `docs/validation/windows-hito-4.md`); el Hito 5 puede cargar la voz de forma perezosa.
- El umbral de 3 s es el de partida; con contenido real (subtítulos incrustados, menús) puede necesitar ajuste: es configurable.
- Primer uso: quien solo tenga los modelos de texto verá el aviso de modelos de audio al arrancar en automático y podrá elegir "Solo texto".
