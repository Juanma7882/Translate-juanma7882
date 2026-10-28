// Menú de la bandeja del sistema: una plantilla pura (sin Electron) para poder probarla.

import type { MenuItemConstructorOptions } from 'electron'

import type { AppState } from '../shared/ipc.ts'
import { ACTIVE_LABELS, MODE_LABELS, MODES, needsRegion } from '../shared/mode.ts'
import type { Mode } from '../shared/mode.ts'

export interface TrayActions {
  chooseRegion(): void
  translateLast(): void
  togglePause(): void
  stop(): void
  setMode(mode: Mode): void
  openSettings(): void
  quit(): void
}

/** `mode` es el modo elegido en los ajustes (el activo, si lo hay, está en `state.mode`). */
export function trayTemplate(state: AppState, hasRegion: boolean, actions: TrayActions, mode: Mode = 'auto'): MenuItemConstructorOptions[] {
  return [
    { label: 'Elegir región…', click: () => actions.chooseRegion() },
    {
      label: 'Traducir la última región',
      // En modo audio no hace falta región.
      enabled: (hasRegion || !needsRegion(mode)) && !state.running && state.phase !== 'starting',
      click: () => actions.translateLast(),
    },
    { label: state.paused ? 'Reanudar' : 'Pausar', enabled: state.running, click: () => actions.togglePause() },
    { label: 'Detener', enabled: state.running, click: () => actions.stop() },
    { type: 'separator' },
    {
      label: 'Modo',
      submenu: MODES.map((m) => ({ label: MODE_LABELS[m], type: 'radio' as const, checked: m === mode, click: () => actions.setMode(m) })),
    },
    { label: 'Ajustes…', click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Salir', click: () => actions.quit() },
  ]
}

export function trayTooltip(state: AppState): string {
  if (state.phase === 'starting') return 'Traductor · iniciando'
  if (state.phase === 'waiting') return 'Traductor · en espera de la aplicación'
  if (!state.running) return 'Traductor · en reposo'
  const active = state.mode ? ` · ${ACTIVE_LABELS[state.mode].toLowerCase()}` : ''
  return state.paused ? `Traductor · en pausa${active}` : `Traductor · traduciendo${active}`
}
