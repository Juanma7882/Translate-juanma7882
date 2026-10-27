import { defineConfig } from 'electron-vite'

// Hito 1: solo proceso principal y proceso utilitario (sin renderers ni preload de producto).
// Las dependencias (tr-bindings, módulo nativo) se externalizan por defecto.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          engine: 'src/engine/worker.ts',
        },
      },
    },
  },
})
