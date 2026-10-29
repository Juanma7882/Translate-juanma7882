# Design

## Context

Ver proposal.md (Why). Estado actual observado:

- `RegionProcessor::process` ([region.rs](crates/tr-core/src/region.rs)) solo emite `Event::Translation` cuando el `Stabilizer` ve un texto estable y distinto del último emitido. Con texto fijo no hay más eventos.
- El renderer del overlay ([overlay/main.ts](app/src/renderer/overlay/main.ts)) arma un `hideTimer` de `hideAfterMs` en cada `show()` y oculta la caja al vencer. No sabe si el texto de la región sigue ahí.
- `set_translating(true)` (llamado desde `fallback.rs` en `ModeChanged`) resetea el `Stabilizer`, de modo que el mismo texto se re-emite al reanudar.
- El `Stabilizer.observe("")` ya se resetea solo cuando el OCR no ve texto.
- Los ajustes llegan al motor por `settings.ts` → `engine-options.ts` → `protocol.ts` → `dispatch.ts` → `EngineOptions` de `tr-bindings` → `tr-engine` (mismo camino que `voiceThreshold`).

## Goals / Non-Goals

**Goals:**
- Con el ajuste activado, la traducción se mantiene mientras el texto de la región no cambie, y reanudar no la regenera.
- Con el ajuste desactivado, nada cambia (ni en el motor ni en el overlay).
- El evento nuevo no lleva contenido.

**Non-Goals:**
- No cambiar `ChangeDetector`, `Stabilizer` ni sus umbrales.
- No tocar el audio ni `hideAfterMs` en modo audio.
- No añadir persistencia de la última traducción: sigue todo en RAM.

## Decisions

1. **Dos mitades independientes, un solo ajuste `overlay.keepWhileUnchanged`.**
   - *Overlay (TS)*: decide ocultar o no. Recibe el ajuste en `OverlayStyle`.
   - *Motor (Rust)*: decide si `set_translating(true)` resetea el `Stabilizer`. Recibe el ajuste por `EngineOptions.keepTranslation`.
   Se guarda en `overlay` porque es lo que el usuario ve, aunque lo lea el motor. Alternativa descartada: ajuste solo en el motor, porque el overlay necesita conocerlo igualmente para no armar el `hideTimer`.

2. **Nuevo `Event::TextCleared` (sin campos) emitido por `RegionProcessor`.** Se emite al pasar de "se emitió una traducción" a "OCR sin texto" (`last_text` vacío), una sola vez, con un indicador `shown: bool` interno que se apaga al emitir y se enciende al emitir una `Translation`. Se emite siempre (con o sin ajuste): es barato, no lleva contenido y el overlay lo ignora si el ajuste está apagado. Alternativa descartada: emitir una `Translation` vacía, porque ensucia el contrato del evento y los consumidores que asumen `original` no vacío.

3. **Overlay: con el ajuste y en modo texto no se arma `hideTimer`.** `show()` deja la caja visible; se oculta con `clear` (que ya existe) cuando llega `textCleared`, al cambiar de modo o al reemplazar el texto. La app (`AppController`) reenvía `textCleared` como `clear` al overlay solo si el ajuste está activo. El renderer ya trata `hideAfterMs <= 0` como "no ocultar", así que se reutiliza esa rama: `OverlayController.applyStyle` envía `hideAfterMs: 0` efectivo cuando el ajuste está activo y el modo es texto, y el valor real en audio. Esto evita tocar la lógica del renderer más allá del modo. Alternativa descartada: añadir un campo nuevo al renderer, porque duplica la regla.

4. **Reanudar no resetea el `Stabilizer` si el ajuste está activo.** `RegionProcessor::set_translating(true)` conserva `emitted`; si el texto no cambió, `observe` devuelve `None` y no hay evento. Si cambió durante la pausa, `ChangeDetector` lo detecta al primer frame y el `Stabilizer` emite el nuevo texto tras `stable_frames`. Si desapareció, `observe("")` resetea y `TextCleared` se emite al reanudar. Con el ajuste desactivado se conserva el reset actual.

5. **El detector de cambio no se reinicia al pausar.** Al reanudar, el primer frame se compara con el último aceptado antes de pausar: igual → sin OCR y sin evento; distinto → OCR normal.

6. **Modo audio y cambios de modo.** Al pasar a audio el overlay ya limpia el texto (requisito "Indicador de modo"). El ajuste solo gobierna el modo texto; en audio `hideAfterMs` real.

## Risks / Trade-offs

- [Traducción que queda pegada si el OCR no detecta la desaparición del texto, por ejemplo por ruido] → `ChangeDetector` y la confianza mínima ya filtran; el usuario puede desactivar el ajuste o pausar. Se mide en el smoke.
- [Overlay oculto por `clear` perdido si el evento llega antes de que la ventana exista] → `clear` es idempotente y el siguiente `show()` pinta de nuevo; sin efectos graves.
- [El ajuste se lee en dos sitios (overlay y motor) y podrían desincronizarse] → ambos se alimentan del mismo valor guardado y `configure` se llama en el mismo flujo que `voiceThreshold`; un test de `engine-options` fija que viaja.
- [Evento nuevo en la API de `tr-bindings`] → cambio aditivo; `index.d.ts` se regenera con el build.

## Migration Plan

Campo nuevo con valor por defecto `false` en `settings.ts`; los archivos de ajustes existentes siguen siendo válidos sin migración. Retroceso: quitar el campo (se ignora al leer).
