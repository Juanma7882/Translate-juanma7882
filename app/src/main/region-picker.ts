// Elegir una región de pantalla: abre el selector, espera la selección y la convierte a la región
// física que entiende el motor. Solo existe un selector a la vez.

import { ipcMain, screen } from 'electron'
import type { BrowserWindow, Display, IpcMainEvent } from 'electron'

import { monitorIndex, toDipRect, toPhysicalRegion } from '../shared/geometry.ts'
import type { DisplayInfo } from '../shared/geometry.ts'
import { Channel } from '../shared/ipc.ts'
import type { DipRect, SelectorInit } from '../shared/ipc.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { WindowManager } from './windows.ts'

/** Lo que se necesita de Electron para saber qué pantallas hay (se sustituye en las pruebas). */
export interface DisplaySource {
  all(): DisplayInfo[]
  /** La pantalla donde está el puntero ahora mismo. */
  underCursor(): DisplayInfo
}

export function toDisplayInfo(display: Display, primaryId: number): DisplayInfo {
  return {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === primaryId,
  }
}

export function electronDisplays(): DisplaySource {
  const infos = (): DisplayInfo[] => {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d) => toDisplayInfo(d, primary))
  }
  return {
    all: infos,
    underCursor: () => {
      const primary = screen.getPrimaryDisplay().id
      return toDisplayInfo(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), primary)
    },
  }
}

export class RegionPicker {
  private readonly windows: WindowManager
  private readonly displays: DisplaySource
  private readonly lastRegion: () => SavedRegion | null
  private pending: Promise<SavedRegion | null> | null = null

  constructor(windows: WindowManager, displays: DisplaySource, lastRegion: () => SavedRegion | null) {
    this.windows = windows
    this.displays = displays
    this.lastRegion = lastRegion
  }

  get isOpen(): boolean {
    return this.pending !== null
  }

  /** Abre el selector sobre `display` (por defecto, la pantalla del puntero). Resuelve `null` si se cancela. */
  pick(display: DisplayInfo = this.displays.underCursor()): Promise<SavedRegion | null> {
    this.pending ??= this.run(display).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async run(display: DisplayInfo): Promise<SavedRegion | null> {
    const all = this.displays.all()
    const electronDisplay = screen.getAllDisplays().find((d) => d.id === display.id)
    if (!electronDisplay) return null

    let window: BrowserWindow
    try {
      window = await this.windows.openSelector(electronDisplay)
    } catch (error) {
      // Cerrar el selector mientras todavía carga aborta la carga: equivale a cancelar.
      if (this.windows.get('selector') === undefined) return null
      throw error
    }
    window.setAlwaysOnTop(true, 'screen-saver')
    window.focus()

    return new Promise<SavedRegion | null>((resolve) => {
      let settled = false
      const finish = (region: SavedRegion | null): void => {
        if (settled) return
        settled = true
        ipcMain.removeListener(Channel.selectorConfirm, onConfirm)
        ipcMain.removeListener(Channel.selectorCancel, onCancel)
        this.windows.close('selector')
        resolve(region)
      }
      const fromThisWindow = (event: IpcMainEvent, win: BrowserWindow): boolean => event.sender === win.webContents

      const onConfirm = (event: IpcMainEvent, rect: DipRect): void => {
        if (!fromThisWindow(event, window)) return
        const region = toPhysicalRegion(rect, display, all)
        if (region) finish(region) // una selección inválida deja el selector abierto
      }
      const onCancel = (event: IpcMainEvent): void => {
        if (fromThisWindow(event, window)) finish(null)
      }
      ipcMain.on(Channel.selectorConfirm, onConfirm)
      ipcMain.on(Channel.selectorCancel, onCancel)
      window.once('closed', () => finish(null))

      const saved = this.lastRegion()
      const sameMonitor = saved !== null && saved.monitor === monitorIndex(all, display)
      const lastRegion = saved && sameMonitor ? (toDipRect(saved, all)?.rect ?? null) : null
      const init: SelectorInit = { lastRegion }
      window.webContents.send(Channel.selectorInit, init)
    })
  }
}
