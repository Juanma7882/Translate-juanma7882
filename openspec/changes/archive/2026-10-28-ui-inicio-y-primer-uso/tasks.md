# Tasks

> Requisito previo: la UI de `audio-fuentes-y-controles` (sus tareas 5.1 a 5.4) integrada, porque este cambio añade filas a la pestaña Inicio que ese cambio crea.

## 1. Lógica pura (home.ts)

- [x] 1.1 `firstRunSteps({ mode, hasRegion, modelsReady, hasEverStarted })`: lista de pasos con estado y primer pendiente; omite la región en modo solo audio; tests con `node --test` de instalación nueva, orden flexible, solo audio y todo completo
- [x] 1.2 `regionSummary(region, mode)` y `modeSentence(mode)`: textos de región (tamaño y posición, «falta», «no necesaria en audio») y frase del modo; tests por modo y con/sin región
- [x] 1.3 `installedPairs(catalog, statusesByPair, scope)`: pares con todos los modelos del ámbito instalados, para el menú rápido; test con pares completos, parciales y ausentes
- [x] 1.4 Guardado de «guía terminada» (`readGuideDone` / `writeGuideDone`) con `try/catch` sobre un almacén inyectable; test con almacén que lanza excepción y con almacén vacío

## 2. IPC «Cambiar región»

- [x] 2.1 Añadir `chooseRegion(): Promise<boolean>` a `SettingsApi` (`ipc.ts`), canal, preload y manejador en `settings-ipc.ts` con guardia de remitente que delega en `AppController.chooseRegion()`; test de IPC (remitente válido, remitente ajeno rechazado, selector cancelado devuelve `false`)
- [x] 2.2 Comprobar que `npm run typecheck` en `app` pasa y que el preload sigue siendo un único archivo autocontenido (`satisfies typeof Channel.x`)

## 3. Pestaña Inicio

- [x] 3.1 `start-guide.tsx`: lista ordenada con estado en texto, botón en el primer paso pendiente (Idiomas / Cambiar región / Iniciar), región `aria-live` al completar un paso y ocultación permanente al terminar; verificar con el test de 1.1/1.4 y un smoke de que la lista aparece sin modelos y desaparece al completarse
- [x] 3.2 `region-row.tsx`: texto de región y botón «Elegir región» / «Cambiar región» que llama a la API, sin error al cancelar y deshabilitado/ausente en modo solo audio; verificar con el smoke de Ajustes en los dos modos
- [x] 3.3 Menú rápido de idiomas en Inicio con el par activo, deshabilitado en marcha con el motivo visible y enlace a la pestaña Idiomas; refresca al terminar una descarga o borrar un modelo; verificar eligiendo otro par instalado y comprobando que `settings.from/to` cambian
- [x] 3.4 Modo en una frase con selector compacto que usa `save({ mode })`; verificar que cambiar el modo en Inicio se refleja en General y viceversa
- [x] 3.5 Estado de la sesión más grande y botón principal destacado (Iniciar / Detener) como primer elemento de la pestaña; verificar que no cambia la lógica de `controlsFor` (los tests existentes de `home.test.ts` siguen pasando)

## 4. Idiomas y Motor

- [x] 4.1 Quitar el fieldset «Idiomas» de General y mover «Motor» a Avanzado con la nota «solo para pruebas sin modelos»; verificar que General ya no tiene `#from`/`#to` y que Avanzado muestra la opción
- [x] 4.2 Actualizar los smokes y tests que usan `#from`, `#to` o `name="engines"` en General y comprobar que `TR_SMOKE=settings`, `shell` y `e2e` pasan

## 5. Apariencia

- [x] 5.1 Vista previa del overlay al principio del panel con `position: sticky` y fondo propio; verificar en una ventana baja que sigue visible al desplazarse hasta Colores
- [x] 5.2 Sección «Posición»: botón «Mover el overlay…» primero y X/Y dentro de `<details>` plegado; verificar con teclado (se abre con Enter/Espacio) y que guardar X/Y sigue funcionando
- [x] 5.3 Ampliar `style-contrast.test.ts` con los colores nuevos (estado grande, paso hecho/pendiente, botón principal) en tema claro y oscuro y comprobar contraste 4,5:1

## 6. Cierre

- [x] 6.1 `cd app && npm run typecheck && npm test` y los smokes `TR_SMOKE=settings|shell|flow` verdes; `cargo` no se toca, pero comprobar con `git status` que ningún archivo de `crates/` cambió
- [x] 6.2 Lista de validación manual en Windows (`docs/validation/windows-inicio.md`): instalación nueva con la guía, «Cambiar región» con el selector sobre la ventana, menú de idiomas en reposo y en marcha, vista previa fija al desplazarse, tema claro y oscuro, solo teclado y lector de pantalla
- [x] 6.3 Guardar en Engram las decisiones del cambio y archivar con `/opsx:archive`
