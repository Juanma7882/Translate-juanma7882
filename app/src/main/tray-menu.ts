// Menú de la bandeja del sistema: una plantilla pura (sin Electron) para poder probarla.

import type { MenuItemConstructorOptions } from 'electron'

import type { AppState } from '../shared/ipc.ts'

export interface TrayActions {
  chooseRegion(): void
  translateLast(): void
  togglePause(): void
  stop(): void
  openSettings(): void
  quit(): void
}

export function trayTemplate(state: AppState, hasRegion: boolean, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Elegir región…', click: () => actions.chooseRegion() },
    { label: 'Traducir la última región', enabled: hasRegion && !state.running, click: () => actions.translateLast() },
    { label: state.paused ? 'Reanudar' : 'Pausar', enabled: state.running, click: () => actions.togglePause() },
    { label: 'Detener', enabled: state.running, click: () => actions.stop() },
    { type: 'separator' },
    { label: 'Ajustes…', click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Salir', click: () => actions.quit() },
  ]
}

export function trayTooltip(state: AppState): string {
  if (!state.running) return 'Traductor · en reposo'
  return state.paused ? 'Traductor · en pausa' : 'Traductor · traduciendo'
}
