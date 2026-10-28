# Proposal

## Why

La ventana de Ajustes es hoy un conjunto de formularios: para traducir por primera vez hay que adivinar el orden (descargar un idioma, elegir la región con un atajo, iniciar desde la bandeja). Además hay configuración duplicada (los idiomas se eligen en dos pestañas), un ajuste de desarrollo (Motor demostración) expuesto a todos y una vista previa del overlay que queda lejos de los controles que la afectan. El cambio `audio-fuentes-y-controles` ya construyó la pestaña **Inicio** (estado, Iniciar/Pausar/Reiniciar/Detener, fuente de audio, medidor); falta convertirla en el punto de partida real de la app.

## What Changes

- La pestaña **Inicio** gana lo que le falta para ser la pantalla principal: la **región elegida** con el botón «Cambiar región», el **par de idiomas** con un menú rápido y el **modo** descrito en una frase. El estado ya existente se muestra más grande y es lo primero que se ve.
- **Primer uso guiado**: una lista de 3 pasos (descargar un idioma, elegir la región, iniciar) en Inicio. Cada paso se tacha solo al cumplirse y la lista desaparece cuando los tres están hechos. En modo solo audio el paso de la región no aplica y no se muestra.
- **Idiomas sin duplicar**: la pestaña «Idiomas» pasa a ser el único sitio para gestionar y elegir el par; se quita el fieldset «Idiomas» de General. El menú rápido de Inicio cambia el par entre los ya instalados.
- **Motor** (local / demostración) pasa de General a Avanzado, rotulado como opción de desarrollo.
- **Apariencia**: la vista previa del overlay queda fija (`position: sticky`) mientras se editan los controles, y el botón «Mover el overlay» sube al principio de la sección «Posición»; X/Y pasan a ser una opción secundaria (plegada).
- Un pequeño IPC nuevo en el proceso principal para que la ventana pueda pedir «Cambiar región» (hoy solo lo hacen el atajo y la bandeja). No cambia Rust, el motor ni el protocolo.

No cambia (fuera de alcance): fuente de audio por aplicación y medidor de nivel (siguen en `audio-fuentes-y-controles`); selector de región y overlay (indicadores de estado, dimensiones en vivo: cambio aparte); guardado diferido de campos numéricos.

## Capabilities

### New Capabilities
- `home-start-screen`: región elegida, «Cambiar región», par de idiomas con menú rápido y frase del modo en la pestaña Inicio.
- `first-run-guide`: lista de 3 pasos de primer uso que se completa sola y se oculta al terminar.

### Modified Capabilities
- `settings-window`: los requisitos «Idiomas», «Motores» y «Apariencia del overlay» cambian (un solo lugar para elegir el par, Motor en Avanzado, vista previa fija y movimiento del overlay como acción principal).

## Impact

- **Electron/TS (renderer de Ajustes)**: `app/src/renderer/settings/main.tsx`, `home-panel.tsx`, `home.ts` (lógica pura nueva: pasos del primer uso, resumen de región), `languages-panel.tsx`, `style.css`.
- **Electron main/shared**: una acción `chooseRegion` en `SettingsApi` (`ipc.ts`, `settings-ipc.ts`, preload) que delega en `AppController.chooseRegion()` ya existente; no se toca la lógica del controlador.
- **Sin cambios**: Rust, napi, protocolo del motor, formato de ajustes.
- **Coordinación**: `home-panel.tsx` y `main.tsx` están siendo modificados por `audio-fuentes-y-controles`. Este cambio se implementa **después** de que esa interfaz (tareas 5.1 a 5.4) esté integrada, y no la reemplaza: añade filas a Inicio sin alterar sus controles ni el medidor.
- **Reglas**: ninguna dependencia nueva; Preact en Ajustes; todo en RAM (la región son coordenadas, ya guardadas en ajustes); accesibilidad (foco, `aria-live`, contraste en tema claro y oscuro) como el resto de la ventana.
