# Tasks

## 1. Núcleo (tr-core)

- [x] 1.1 Añadir `Event::TextCleared` (sin campos) en `types.rs` y verificar que `cargo test -p tr-core` compila y los `match` exhaustivos existentes quedan cubiertos
- [x] 1.2 En `RegionProcessor` llevar un indicador `shown` (se enciende al emitir `Translation`, se apaga al emitir `TextCleared`) y emitir `TextCleared` una sola vez al pasar a texto vacío; tests en `region.rs`: una emisión al desaparecer, ninguna con la región vacía de forma sostenida, ninguna si nunca se tradujo nada
- [x] 1.3 Añadir `keep_translation` a `RegionConfig` y hacer que `set_translating(true)` solo resetee el `Stabilizer` si es `false`; tests en `region.rs`: con el ajuste, pausar y reanudar con el mismo texto no emite nada (sin llamadas al traductor); con texto distinto emite el nuevo; con texto desaparecido emite `TextCleared`; sin el ajuste se conserva el comportamiento actual (el test `disabling_translation_keeps_ocr_but_emits_nothing` sigue pasando)
- [x] 1.4 Test de integración en `crates/tr-core/tests/fallback_pipeline.rs`: pausa y reanudación con pantalla fija no produce una segunda `Translation` con el ajuste activo

## 2. Motor y puente (tr-engine, tr-bindings)

- [x] 2.1 Añadir `keep_translation` a `EngineOptions` en `tr-engine` y pasarlo a `RegionConfig`; test en `crates/tr-engine/tests/engine.rs` con los motores de demostración
- [x] 2.2 Exponer `keepTranslation` en `EngineOptions` de `tr-bindings` y el evento `textCleared` (`events.rs`, sin payload de texto); verificar con `cd crates/tr-bindings && pnpm run build:debug && pnpm test` y que `index.d.ts` incluye ambos
- [x] 2.3 Verificar `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`, incluido el test `no_content_leaks`

## 3. Ajustes (app/shared)

- [x] 3.1 Añadir `keepWhileUnchanged: boolean` a `OverlaySettings` con valor por defecto `false`, lectura tolerante a archivos antiguos y validación; tests en `settings*.test.ts` (por defecto, migración de un archivo sin el campo, tipo inválido)
- [x] 3.2 Pasar el ajuste a `EngineOptions` en `engine-options.ts`, `protocol.ts` y `dispatch.ts`; tests en `engine-options-*.test.ts` y `dispatch.test.ts` que comprueben que viaja
- [x] 3.3 Añadir `textCleared` al tipo de eventos del motor (`protocol.ts`) y reenviarlo desde `AppController.onEngineEvent` como evento `clearText`; test en `app-controller.test.ts`

## 4. Overlay

- [x] 4.1 En `OverlayController.applyStyle` enviar `hideAfterMs` efectivo en 0 cuando el ajuste está activo y el modo es texto, y el valor real en audio, reenviando el estilo al cambiar de modo; test unitario del cálculo
- [x] 4.2 En `AppShell` conectar `clearText` a `overlay.clear()` solo si el ajuste está activo; test en `app-shell*.test.ts` con el ajuste activo y desactivado
- [x] 4.3 Casilla "Mantener la traducción mientras el texto no cambie" en Ajustes > Overlay (`settings/main.tsx`, textos y claves en `form.ts`) con su texto de ayuda; verificar con `cd app && pnpm run typecheck && pnpm test`

## 5. Verificación y cierre

- [x] 5.1 Ampliar `TR_SMOKE=overlay` para comprobar: con el ajuste, la traducción sigue visible pasado `hideAfterMs`, se oculta con `textCleared`, y en audio se oculta por tiempo; ejecutar el smoke y que pase
- [x] 5.2 Ejecutar `TR_SMOKE=e2e` bajo `scripts/with-xvfb.sh` con el ajuste activo, pausando y reanudando con la pantalla fija, y verificar que no hay segunda traducción (verificado en Windows nativo, sin Xvfb: el smoke activa `keepWhileUnchanged`, pausa y reanuda, y comprueba durante 5 s que no llega texto nuevo y la traducción sigue a la vista)
- [x] 5.3 Añadir el caso a `docs/validation/windows-hito-5.md` (lista manual) y actualizar `docs/adr` con una nota breve de la decisión; guardar la decisión en Engram
