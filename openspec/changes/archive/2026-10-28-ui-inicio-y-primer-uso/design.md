# Design

## Context

La ventana de Ajustes es una app Preact (`app/src/renderer/settings/main.tsx`) con pestañas. `audio-fuentes-y-controles` ya añadió la pestaña Inicio (`home-panel.tsx` con su lógica pura en `home.ts`): estado de sesión, botones Iniciar/Pausar/Reiniciar/Detener, selector de fuente, medidor de nivel y aviso de modelos faltantes (`MissingModels`, que ya consulta `modelStatus` y salta a Idiomas). Ese cambio está en curso (UI hecha, pendiente de integrar y archivar).

Lo que existe y se reutiliza:
- `AppController.chooseRegion()` abre el selector, guarda `lastRegion` y empieza a traducir; solo lo invocan el atajo y la bandeja. `SettingsApi` no lo expone.
- `settings.lastRegion` ya llega al renderer (`Settings`), así que mostrar la región no necesita IPC.
- `LanguagesPanel` ya calcula el estado de cada par con `modelStatus` + `summarize`.
- `needsRegion(mode)` y `scopeForMode(mode)` (en `shared/mode.ts`) ya dicen si un modo necesita región y qué modelos necesita.

Restricciones: Preact en Ajustes, sin dependencias nuevas, sin tocar Rust ni el protocolo, `lib` pura en `home.ts`/`form.ts` con tests (`node --test` sobre TS), contraste AA en tema claro y oscuro (hay un test de contraste de estilos), la ventana no se bloquea.

## Goals / Non-Goals

**Goals:**
- Inicio es la pantalla donde se puede preparar y arrancar una traducción sin ir a otra pestaña, salvo para descargar.
- El usuario nuevo ve qué paso falta; el usuario con experiencia no ve ruido (la guía se esconde).
- Un solo lugar para gestionar idiomas; ajustes de desarrollo fuera del camino.
- Ver el efecto de los cambios de Apariencia sin desplazarse.

**Non-Goals:**
- No se rediseña el selector de región ni el overlay (cambio aparte).
- No se toca el medidor ni la fuente por aplicación (los posee `audio-fuentes-y-controles`).
- No hay cambios de formato de ajustes, import/export ni migraciones.

## Decisions

### 1. Se construye sobre la pestaña Inicio existente, después del cambio de audio
Se añaden filas a `HomePanel` (guía, región, idiomas, modo) sin cambiar sus controles ni su lógica de sesión. Se implementa tras integrar la UI del cambio de audio (sus tareas 5.1 a 5.4), para no resolver conflictos en `home-panel.tsx` y `main.tsx` que ambos tocan. *Alternativa:* fusionar todo en `audio-fuentes-y-controles` → mezcla un cambio de Rust/plataforma con uno de presentación y retrasa ambos.

### 2. Lógica en funciones puras en `home.ts`
`firstRunSteps(input)` recibe `{ mode, hasRegion, modelsReady, hasEverStarted }` y devuelve la lista de pasos con su estado y el índice del primero pendiente; `regionSummary(region, mode)` devuelve el texto de región; `modeSentence(mode)` la frase. El componente solo pinta. *Por qué:* es como ya está hecho `home.ts`, se prueba sin DOM y la regla del proyecto es testear antes de avanzar.

### 3. Estado «guía terminada» en `localStorage` del renderer
Condiciones de los pasos: (1) modelos del par activo y del ámbito del modo instalados (`modelStatus` + `summarize`, igual que `MissingModels`); (2) `settings.lastRegion !== null` (se omite si el modo no necesita región); (3) se ha visto una sesión en marcha en esta ventana o antes. Al cumplirse los tres se guarda `guideDone=1` y la guía no vuelve a salir. Lectura y escritura dentro de `try/catch`; si falla, la guía se calcula en cada apertura (nunca rompe la ventana).
*Alternativas:* un campo `guideDone` en ajustes → toca `settings.ts`, validación, migración e import/export por algo puramente de presentación; descartado (y exportarlo sería incorrecto: no es una preferencia). Derivar siempre del estado real → la guía reaparecería al borrar un modelo, que molesta a usuarios con experiencia.
*Coste:* limpiar los datos del navegador de la app reinicia la guía; es inocuo.

### 4. «Cambiar región» = nueva acción `chooseRegion` en `SettingsApi`
Un canal IPC nuevo (`ipc.ts`, `settings-ipc.ts`, preload) con guardia de remitente igual que las acciones de sesión, que llama a `AppController.chooseRegion()` y devuelve si se eligió. Comportamiento heredado: elegir una región empieza a traducir (igual que el atajo). Se muestra «iniciando» con el mismo mecanismo de acciones de Inicio. Cancelar el selector devuelve `false` sin aviso. *Alternativa:* solo guardar la región sin iniciar → exigiría un método nuevo en el controlador y dos caminos distintos para lo mismo; se prefiere la coherencia con el atajo.

### 5. Menú rápido de idiomas desde el estado ya calculado
El menú lista solo los pares con todos los modelos del ámbito del modo instalados (reutilizando `summarize` por par, como `LanguagesPanel`); la información se carga una vez al abrir la pestaña y se refresca cuando termina una descarga o se borra un modelo. Se guarda con el mismo `save({ from, to })`. Mientras `appState.running`, el menú está deshabilitado con el motivo visible (cambiar el par en marcha exige reiniciar; ya es la regla de «Usar» en Idiomas). *Alternativa:* permitir cambiar en marcha y reiniciar solos → comportamiento sorpresivo; fuera de alcance.

### 6. Modo en Inicio: los mismos radios, compactos
Se reutiliza el mismo guardado `save({ mode })` que General. General conserva el selector completo y el tiempo de fallback; Inicio muestra los tres modos y la frase. No hay estado duplicado: ambos leen `settings.mode`.

### 7. Idiomas y Motor: quitar y mover, sin cambiar comportamiento
Se elimina el `fieldset` «Idiomas» de General (`main.tsx`) y se mueve el de «Motor» a Avanzado con la etiqueta «solo para pruebas». Los identificadores (`#from`, `#to`) que usan los smokes de Ajustes se revisan y sus pruebas se actualizan. El filtrado de destinos (`pickPair`, `targetLanguages`) sigue usándose desde Inicio y la pestaña Idiomas.

### 8. Apariencia: vista previa `sticky` y posición plegada
La vista previa pasa al principio del panel con `position: sticky; top: 0` y fondo propio (ya pinta sus colores). La sección «Posición» pone el botón «Mover el overlay…» primero y envuelve X/Y en `<details>` (accesible por teclado, sin JS). Solo HTML/CSS. *Alternativa:* dos columnas → complica ventanas estrechas; `sticky` funciona a cualquier ancho.

## Risks / Trade-offs

- [Conflicto de merge con `audio-fuentes-y-controles` en `home-panel.tsx`/`main.tsx`] → implementar después de integrar su UI; las filas nuevas se añaden como subcomponentes en archivos propios (`start-guide.tsx`, `region-row.tsx`) para minimizar el contacto.
- [La guía puede marcar «hecho» un paso por una condición que se rompe luego (modelo borrado)] → la guía no reaparece por diseño; los avisos de `MissingModels` cubren ese caso.
- [`chooseRegion` desde Ajustes: la ventana de Ajustes puede quedar tapada por el selector a pantalla completa] → el selector ya es una ventana propia sobre todas las demás y devuelve el foco al cerrarse; se comprueba en la validación manual de Windows.
- [Un cambio de idioma desde Inicio con sesión en marcha] → menú deshabilitado con motivo, no se reinicia nada implícitamente.
- [localStorage no disponible o vacío] → todo envuelto en `try/catch`; la guía solo pierde la memoria de «ya terminó».
- [Los smokes de Ajustes (`TR_SMOKE=settings|shell|e2e`) dependen de los ids de General] → tarea explícita para ajustarlos y ejecutarlos.
