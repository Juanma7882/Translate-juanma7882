# ADR 0001 — Stack de UI: electron-vite + TypeScript, sin framework

- Estado: aceptado
- Fecha: 2026-10-27

## Contexto

La app necesita tres ventanas con HTML (más el tray, que es un menú nativo):

| Ventana | Complejidad de UI |
|---|---|
| Selector de región | Muy baja: rectángulo arrastrable, vive solo mientras se usa |
| Overlay | Muy baja: dos nodos de texto, estilos por variables CSS |
| Ajustes | Media: formularios, estado, progreso de descarga de modelos |

Todo el estado complejo (pipeline, caché, eventos) vive en Rust. La UI solo pinta eventos (`onTranslation`, `onSubtitle`, `onError`, `onModelProgress`) y envía comandos.

## Decisión

- **electron-vite + TypeScript**, build multi-página (una entrada HTML por ventana). Un solo proyecto construye main, preload y renderers, con HMR.
- **Selector y overlay**: TS plano + CSS con variables. Sin framework.
- **Ajustes**: **Preact** (~3 KB, API tipo React), o TS plano mientras se mantenga chico.
- **Estilos**: CSS con variables. Tailwind solo en Ajustes y solo si se quiere.

## Por qué

- Chromium ya consume cientos de MB por ventana. El peso de un framework (React ~45 KB) es irrelevante frente a eso; lo que ahorra recursos es tener pocas ventanas y crear el selector solo al usarlo.
- Selector y overlay son casi estáticos: un framework no aporta nada y agrega superficie de mantenimiento.
- La lógica no vive en la UI, así que no necesitamos gestión de estado en el renderer.
- Preact da componentes y reactividad donde sí se necesitan (Ajustes) por una fracción del costo de React.
- **Astro descartado**: está pensado para sitios de contenido (SSG, SEO, routing). No empaqueta main ni preload de Electron, lo que obligaría a dos sistemas de build, y trae fricción con `file://`/protocolos propios en producción. Vite multi-página da el mismo resultado con una herramienta menos.
- **React descartado**: sin necesidad real; Preact cubre el caso con la misma API.

## Alternativas consideradas

- React + Tailwind: válido, pero más pesado y sin ventaja aquí.
- Astro + islas: viable, pero doble build y funciones sin uso.
- Svelte / Lit: buenas opciones; equivalentes a Preact para Ajustes. Se pueden elegir sin tocar el resto.

## Si la UI crece

Escalar por pasos, solo cuando aparezca el dolor:

1. **Ajustes crece** (muchas pantallas, estado compartido): quedarse en Preact y sumar `@preact/signals` para el estado. Sin cambiar de librería.
2. **Los componentes se repiten** (inputs, selects, barras de progreso): extraer una carpeta `renderer/ui/` con componentes propios o sumar una librería de componentes headless.
3. **Aparecen ventanas nuevas con UI rica** (editor de glosario, historial, onboarding largo): migrar solo esa ventana a un framework mayor (React o Svelte) como entrada independiente. El build multi-página lo permite sin reescribir las demás.
4. **Overlay o selector crecen** (cambios en vivo complejos): primero Lit o Preact puntual en esa ventana; no migrar todo.
5. **Nunca** mover lógica de negocio al renderer: sigue en Rust detrás de la API chica (`startRegionTranslation`, `startAudioSubtitles`, `stop` + eventos). Eso es lo que mantiene barato cambiar de framework.

Señales para reconsiderar: más de ~5 ventanas con HTML, estado compartido entre ventanas que ya no cabe en eventos, o necesidad de un sistema de diseño completo.
