// Atajos globales configurables. El registro puede fallar (otra aplicación ya usa la combinación o
// el sistema no la admite): cada fallo se informa con un aviso en vez de ignorarse.

import type { Notice } from '../shared/ipc.ts'
import type { Shortcuts } from '../shared/settings.ts'

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export type ShortcutHandlers = { [K in keyof Shortcuts]: () => void }

const LABELS: Record<keyof Shortcuts, string> = {
  selectRegion: 'elegir región',
  togglePause: 'pausar o reanudar',
  toggleMode: 'cambiar de modo',
}

export class ShortcutManager {
  private readonly api: GlobalShortcutLike
  private readonly report: (notice: Notice) => void
  private registered: string[] = []

  constructor(api: GlobalShortcutLike, report: (notice: Notice) => void) {
    this.api = api
    this.report = report
  }

  /** Quita los atajos anteriores y registra `shortcuts`. Devuelve los que no se pudieron registrar. */
  apply(shortcuts: Shortcuts, handlers: ShortcutHandlers): (keyof Shortcuts)[] {
    this.dispose()
    const failed: (keyof Shortcuts)[] = []
    const used = new Set<string>()
    for (const key of Object.keys(LABELS) as (keyof Shortcuts)[]) {
      const accelerator = shortcuts[key]
      let ok = false
      let reason = 'ya lo usa otra aplicación o el sistema no lo admite'
      if (used.has(accelerator.toLowerCase())) {
        reason = 'se repite en otro atajo'
      } else {
        try {
          ok = this.api.register(accelerator, handlers[key])
        } catch {
          reason = 'no es una combinación válida'
        }
      }
      if (ok) {
        used.add(accelerator.toLowerCase())
        this.registered.push(accelerator)
      } else {
        failed.push(key)
        this.report({
          level: 'warning',
          message: `No se pudo registrar el atajo ${accelerator} (${LABELS[key]}): ${reason}. Cámbialo en Ajustes.`,
        })
      }
    }
    return failed
  }

  dispose(): void {
    for (const accelerator of this.registered) this.api.unregister(accelerator)
    this.registered = []
  }
}
