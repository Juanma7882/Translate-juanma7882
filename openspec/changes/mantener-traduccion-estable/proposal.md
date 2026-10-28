# Proposal

## Why

En modo texto, con una región que tiene texto fijo en pantalla, la traducción desaparece sola a los `hideAfterMs` (4 s por defecto) aunque el texto original siga ahí, porque el `Stabilizer` solo emite cuando el texto cambia y el overlay interpreta "sin traducciones nuevas" como "sin texto". Además, al pausar y reanudar, `RegionProcessor::set_translating` resetea el `Stabilizer`: el mismo texto se vuelve a emitir y el overlay lo reemplaza, lo que se ve como si se regenerara. El usuario quiere que, si la pantalla no cambió, la traducción ya mostrada se mantenga.

## What Changes

- Nuevo ajuste de overlay `keepWhileUnchanged` (por defecto desactivado; casilla "Mantener la traducción mientras el texto no cambie" en Ajustes > Overlay). Desactivado: comportamiento actual, sin cambios.
- Con el ajuste activado y en modo texto:
  - El overlay NO oculta la traducción por `hideAfterMs`. Se oculta solo cuando la región se queda sin texto o cuando llega otra traducción.
  - Reanudar tras una pausa NO resetea el `Stabilizer`: si el texto no cambió no se vuelve a emitir y el overlay no parpadea; si cambió durante la pausa, se traduce el nuevo.
- Nuevo evento del motor `textCleared` ("la región se quedó sin texto"), emitido una sola vez al pasar de texto emitido a región vacía. Solo lleva el hecho, nunca contenido.
- En modo audio `hideAfterMs` sigue aplicando igual (los subtítulos son efímeros).

## Capabilities

### New Capabilities
- `stable-translation`: mantener la traducción mostrada mientras el texto de la región no cambie (ajuste, evento de región vacía y reanudación sin regenerar).

### Modified Capabilities
- `translation-overlay`: el escenario "Sin texto" de "Original y traducción visibles" pasa a depender del ajuste (ocultar por tiempo o por región vacía).

## Impact

- Rust: `tr-core` (`types.rs` evento `TextCleared`, `region.rs` emisión y `set_translating`, `fallback.rs` opción), `tr-engine` (`EngineOptions`), `tr-bindings` (`events.rs`, `index.d.ts`, opción de `configure`).
- App: `app/src/shared/settings.ts` (campo, validación, migración por defecto), `shared/ipc.ts` (`OverlayStyle`, evento), `main/app-controller.ts` (reenvía `textCleared`), `main/overlay-controller.ts`, `renderer/overlay/main.ts`, `renderer/settings/main.tsx` y `form.ts`.
- Tests: Rust (region, fallback), settings, overlay y smoke del overlay.
- Sin dependencias nuevas. Regla de memoria intacta: el evento no lleva texto y nada se escribe a disco.
