// Resolución de la ruta del módulo nativo (napi-rs) desde el proceso utilitario.
//
// Orden: `TR_NATIVE_DIR` (pruebas y diagnóstico) > `<resources>/native` (app empaquetada, fuera del
// asar: ver `extraResources` en electron-builder.yml) > `null`, que significa "usar el paquete
// `tr-bindings` enlazado en desarrollo".

import { join } from 'node:path'

export interface NativeLookup {
  env: Record<string, string | undefined>
  /** `process.resourcesPath` de Electron; en desarrollo apunta a los recursos de Electron. */
  resourcesPath: string | undefined
  exists: (path: string) => boolean
}

/** Ruta absoluta de `api.js` del módulo nativo, o `null` si hay que usar `tr-bindings`. */
export function resolveNativeEntry({ env, resourcesPath, exists }: NativeLookup): string | null {
  const override = env['TR_NATIVE_DIR']
  if (override) return join(override, 'api.js')
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'native', 'api.js')
    if (exists(packaged)) return packaged
  }
  return null
}
