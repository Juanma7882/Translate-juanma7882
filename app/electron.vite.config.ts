import { resolve } from 'node:path'

import preact from '@preact/preset-vite'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// Política de contenido de las ventanas: solo scripts y estilos propios, sin red ni objetos embebidos.
// En desarrollo (`electron-vite dev`) el servidor de Vite necesita su cliente de recarga en caliente.
const STRICT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const DEV_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'tr-content-security-policy',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html.replace('__CSP__', ctx.server ? DEV_CSP : STRICT_CSP)
      },
    },
  }
}

// Procesos: main (con el proceso utilitario del motor), un preload mínimo por ventana y tres renderers.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          engine: resolve('src/engine/worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Con `sandbox: true` un preload solo puede hacer `require('electron')`, así que no puede haber
      // chunks compartidos entre preloads: ninguno importa código de `shared/` en tiempo de ejecución
      // (solo tipos; los nombres de canal se comprueban en compilación con `satisfies`).
      // `isolatedEntries` de electron-vite 5.0.0 no se usa: es experimental y falla sin terminal (CI).
      rollupOptions: {
        input: {
          selector: resolve('src/preload/selector.ts'),
          overlay: resolve('src/preload/overlay.ts'),
          settings: resolve('src/preload/settings.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [preact(), contentSecurityPolicy()],
    build: {
      rollupOptions: {
        input: {
          selector: resolve('src/renderer/selector/index.html'),
          overlay: resolve('src/renderer/overlay/index.html'),
          settings: resolve('src/renderer/settings/index.html'),
        },
      },
    },
  },
})
