# Tasks

## 1. Decisión y documentación previa

- [x] 1.1 Escribir `docs/adr/0011-guardar-transcripcion.md` (enmienda de la regla nº 1, alternativas y consecuencias) y verificar que enlaza a la spec `transcript-saving`
- [x] 1.2 Reescribir la regla nº 1 en `CLAUDE.md` y los comentarios de `settings-store.ts` / `shared/settings.ts` que dicen «única escritura a disco» y verificar con `grep` que no quedan afirmaciones contradictorias

## 2. Ajustes

- [x] 2.1 Añadir `transcript: { enabled, dir, srt }` a `shared/settings.ts` (tipos, defecto, `parseSettings`, `applyPatch`: `enabled` exige `dir`) y verificar con tests (`settings-transcript.test.ts`: activar sin carpeta rechazado, clave ausente → defecto)
- [x] 2.2 `SettingsStore.reset()` conserva `transcript.dir` y apaga `enabled`; exportar omite `transcript` e importar la ignora; verificar con `settings-store-reset.test.ts` y un test de export/import
- [x] 2.3 IPC: canal `transcriptPickDir` (diálogo propio, `pickTranscriptFolder`) y validación de carpeta (absoluta, existe, carpeta, `W_OK`) en `settings-ipc.ts` vía `transcript-dir.ts`; verificar con `transcript-dir.test.ts` (carpeta temporal, inexistente, archivo, relativa)

## 3. Formato

- [x] 3.1 Crear `app/src/shared/transcript-format.ts` (`formatTxtEntry`, `formatSrtEntry`, `srtTime`, `sessionFileName`, normalización para dedupe) y verificar con `transcript-format.test.ts`: tiempos `HH:MM:SS,mmm`, fin acotado [1 s, 7 s] sin solapes, orden de destinos, entrada solo con original si fallan traducciones

## 4. Escritor

- [x] 4.1 Crear `app/src/main/transcript-writer.ts` con streams `wx`, sufijo numérico ante colisión, entrada `.srt` pendiente, dedupe, reloj de sesión y cierre que espera a la apertura en curso; verificar con `transcript-writer.test.ts` sobre carpeta temporal (parciales ignorados, repetidos omitidos, pausa sigue en los mismos archivos, sin `.srt` si está desactivado, nombre existente no sobrescrito)
- [x] 4.2 Manejo de errores: ante un error cerrar, no reabrir en la sesión y emitir el aviso sin contenido; verificar con un test que borra la carpeta antes de abrir
- [x] 4.3 Integrar en `AppShell` con `bindTranscript` (eventos `state`/`text` del controlador: inicio y fin de sesión, pausa sin cortar) y `settings.onChange` para activar/desactivar en vivo; exponer `saving` del escritor a overlay y bandeja; verificar con `transcript-session.test.ts` y los tests de activar/desactivar a mitad de sesión
- [x] 4.4 Test de guardas `transcript-no-write.test.ts`: con `enabled: false` no aparece ningún archivo; y búsqueda de escrituras a disco en `app/src` que solo admite `settings-store.ts`, `settings-ipc.ts` (exportar) y `transcript-writer.ts` (y smokes); verificado que pasa y que falla si se añade un `writeFileSync` fuera de lista

## 5. Interfaz

- [x] 5.1 Ajustes (pestaña General, Preact): «Elegir carpeta…» con la ruta visible, casilla «Guardar la transcripción», casilla «También en .srt», errores con `aria-describedby`; verificar con `TR_SMOKE=settings`
- [x] 5.2 Bandeja: casilla «Guardar transcripción» (deshabilitada sin carpeta) y tooltip en `tray-menu.ts`; verificar con `tray-menu.test.ts`
- [x] 5.3 Overlay: indicador «Guardando transcripción» cuando `saving` es verdadero, visible con la caja oculta y con `aria-label`; verificar con `TR_SMOKE=overlay`
- [x] 5.4 Texto del aviso de error en `notices.ts`; verificar con `notices.test.ts`

## 6. Verificación integral

- [x] 6.1 `cd app && pnpm run typecheck && pnpm test` y `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` en verde
- [x] 6.2 E2E real con guardado activo (`smoke:e2e` ampliado): se crean `.txt` y `.srt` con la línea real reconocida y traducida y el `.srt` tiene formato válido; con el interruptor apagado no se crea nada (`TR_SMOKE=shell` y `transcript-no-write.test.ts`). Abrir el `.srt` en un reproductor queda en la lista manual (6.3)
- [ ] 6.3 Añadir `docs/validation/windows-transcripcion.md` (lista manual en Windows: audio, texto, pausa, activar/desactivar en vivo, carpeta borrada, export sin transcripción) y la sección de privacidad del README; verificar ejecutándola en Windows
