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

/** Cuánto se enseña la región guardada al pedir verla. */
const PREVIEW_MS = 2500

/** Marca interna: el usuario pidió el selector en la pantalla siguiente. */
const NEXT_DISPLAY = Symbol('next-display')

export class RegionPicker {
  private readonly windows: WindowManager
  private readonly displays: DisplaySource
  private readonly lastRegion: () => SavedRegion | null
  private pending: Promise<SavedRegion | null> | null = null
  private previewing = false

  constructor(windows: WindowManager, displays: DisplaySource, lastRegion: () => SavedRegion | null) {
    this.windows = windows
    this.displays = displays
    this.lastRegion = lastRegion
  }

  get isOpen(): boolean {
    return this.pending !== null
  }

  /**
   * Abre el selector sobre `display` (por defecto, la pantalla del puntero). Con Tab el usuario lo pasa a la
   * pantalla siguiente, así puede elegir una región en cualquier monitor. Resuelve `null` si se cancela.
   */
  pick(display: DisplayInfo = this.displays.underCursor()): Promise<SavedRegion | null> {
    this.cancelPreview()
    this.pending ??= this.loop(display).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /**
   * Marca `region` sobre su pantalla durante `ms` milisegundos, sin aceptar ratón ni teclado.
   * Devuelve `false` si hay un selector abierto o la región ya no cae en ningún monitor.
   */
  async preview(region: SavedRegion, ms = PREVIEW_MS): Promise<boolean> {
    if (this.pending) return false
    this.cancelPreview()
    const all = this.displays.all()
    const located = toDipRect(region, all)
    const electronDisplay = located && screen.getAllDisplays().find((d) => d.id === located.display.id)
    if (!located || !electronDisplay) return false

    const window = await this.windows.openSelector(electronDisplay)
    // El usuario puede haber abierto el selector mientras cargaba la vista previa: gana el selector.
    if (this.pending) {
      this.windows.close('selector')
      return false
    }
    window.setIgnoreMouseEvents(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    const init: SelectorInit = { lastRegion: located.rect, screen: { index: monitorIndex(all, located.display) + 1, total: all.length }, preview: true }
    window.webContents.send(Channel.selectorInit, init)
    const timer = setTimeout(() => this.cancelPreview(), ms)
    window.once('closed', () => {
      clearTimeout(timer)
      this.previewing = false
    })
    this.previewing = true
    return true
  }

  private cancelPreview(): void {
    if (!this.previewing) return
    this.previewing = false
    this.windows.close('selector')
  }

  private async loop(first: DisplayInfo): Promise<SavedRegion | null> {
    let display = first
    for (;;) {
      const result = await this.run(display)
      if (result !== NEXT_DISPLAY) return result
      const all = this.displays.all()
      const at = all.findIndex((d) => d.id === display.id)
      display = all[(at + 1) % all.length] ?? first
    }
  }

  private async run(display: DisplayInfo): Promise<SavedRegion | null | typeof NEXT_DISPLAY> {
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

    return new Promise<SavedRegion | null | typeof NEXT_DISPLAY>((resolve) => {
      let settled = false
      const finish = (region: SavedRegion | null | typeof NEXT_DISPLAY): void => {
        if (settled) return
        settled = true
        ipcMain.removeListener(Channel.selectorConfirm, onConfirm)
        ipcMain.removeListener(Channel.selectorCancel, onCancel)
        ipcMain.removeListener(Channel.selectorNextDisplay, onNext)
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
      const onNext = (event: IpcMainEvent): void => {
        if (fromThisWindow(event, window) && all.length > 1) finish(NEXT_DISPLAY)
      }
      ipcMain.on(Channel.selectorConfirm, onConfirm)
      ipcMain.on(Channel.selectorCancel, onCancel)
      ipcMain.on(Channel.selectorNextDisplay, onNext)
      window.once('closed', () => finish(null))

      const saved = this.lastRegion()
      const sameMonitor = saved !== null && saved.monitor === monitorIndex(all, display)
      const lastRegion = saved && sameMonitor ? (toDipRect(saved, all)?.rect ?? null) : null
      const init: SelectorInit = { lastRegion, screen: { index: monitorIndex(all, display) + 1, total: all.length } }
      window.webContents.send(Channel.selectorInit, init)
    })
  }
}
