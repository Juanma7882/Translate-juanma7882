// Elegir dónde mostrar el overlay de traducción: abre el selector, espera la selección de área.
// Similar a RegionPicker pero selecciona dónde mostrar la traducción en lugar de qué traducir.

import { ipcMain, screen } from 'electron'
import type { BrowserWindow, Display, IpcMainEvent } from 'electron'

import { monitorIndex, toDipRect } from '../shared/geometry.ts'
import type { DisplayInfo } from '../shared/geometry.ts'
import { Channel } from '../shared/ipc.ts'
import type { DipRect, SelectorInit } from '../shared/ipc.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { WindowManager } from './windows.ts'

/** Posición del overlay elegida por el usuario: x, y en píxeles de pantalla. */
export interface OverlayPosition {
  x: number
  y: number
}

export interface DisplaySource {
  all(): DisplayInfo[]
  underCursor(): DisplayInfo
}

const NEXT_DISPLAY = Symbol('next-display')

/**
 * Selector de área del overlay: similar a RegionPicker pero devuelve la posición elegida
 * (x, y) en lugar de una región física. Se muestra sobre la región a traducir para que
 * el usuario vea cómo se superponen.
 */
export class OverlayPicker {
  private readonly windows: WindowManager
  private readonly displays: DisplaySource
  private readonly region: SavedRegion
  private pending: Promise<OverlayPosition | null> | null = null

  constructor(windows: WindowManager, displays: DisplaySource, region: SavedRegion) {
    this.windows = windows
    this.displays = displays
    this.region = region
  }

  get isOpen(): boolean {
    return this.pending !== null
  }

  /**
   * Abre el selector sobre `display` (por defecto, la pantalla de la región).
   * El usuario elige dónde mostrar el overlay. Resuelve `null` si se cancela.
   */
  pick(display: DisplayInfo = this.displayForRegion()): Promise<OverlayPosition | null> {
    this.pending ??= this.loop(display).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /**
   * Muestra el selector en modo preview durante unos segundos sin permitir cambios.
   * Devuelve `false` si hay un selector abierto o la región no se puede ubicar.
   */
  async preview(): Promise<boolean> {
    if (this.pending) return false
    const all = this.displays.all()
    const located = toDipRect(this.region, all)
    const electronDisplay = located && screen.getAllDisplays().find((d) => d.id === located.display.id)
    if (!located || !electronDisplay) return false

    const window = await this.windows.openSelector(electronDisplay)
    if (this.pending) {
      this.windows.close('selector')
      return false
    }
    window.setIgnoreMouseEvents(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    const init: SelectorInit = { lastRegion: located.rect, screen: { index: monitorIndex(all, located.display) + 1, total: all.length }, preview: true }
    window.webContents.send(Channel.selectorInit, init)
    const timer = setTimeout(() => this.windows.close('selector'), 2500)
    window.once('closed', () => clearTimeout(timer))
    return true
  }

  private displayForRegion(): DisplayInfo {
    const all = this.displays.all()
    const located = toDipRect(this.region, all)
    return located?.display ?? this.displays.underCursor()
  }

  private async loop(first: DisplayInfo): Promise<OverlayPosition | null> {
    let display = first
    for (;;) {
      const result = await this.run(display)
      if (result !== NEXT_DISPLAY) return result
      const all = this.displays.all()
      const at = all.findIndex((d) => d.id === display.id)
      display = all[(at + 1) % all.length] ?? first
    }
  }

  private async run(display: DisplayInfo): Promise<OverlayPosition | null | typeof NEXT_DISPLAY> {
    const all = this.displays.all()
    const electronDisplay = screen.getAllDisplays().find((d) => d.id === display.id)
    if (!electronDisplay) return null

    let window: BrowserWindow
    try {
      window = await this.windows.openSelector(electronDisplay)
    } catch (error) {
      if (this.windows.get('selector') === undefined) return null
      throw error
    }
    window.setAlwaysOnTop(true, 'screen-saver')
    window.focus()

    return new Promise<OverlayPosition | null | typeof NEXT_DISPLAY>((resolve) => {
      let settled = false
      const finish = (result: OverlayPosition | null | typeof NEXT_DISPLAY): void => {
        if (settled) return
        settled = true
        ipcMain.removeListener(Channel.selectorConfirm, onConfirm)
        ipcMain.removeListener(Channel.selectorCancel, onCancel)
        ipcMain.removeListener(Channel.selectorNextDisplay, onNext)
        this.windows.close('selector')
        resolve(result)
      }
      const fromThisWindow = (event: IpcMainEvent, win: BrowserWindow): boolean => event.sender === win.webContents

      const onConfirm = (event: IpcMainEvent, rect: DipRect): void => {
        if (!fromThisWindow(event, window)) return
        // El usuario selecciona un área; usamos su esquina superior izquierda como posición del overlay
        finish({ x: Math.round(rect.x), y: Math.round(rect.y) })
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

      // Mostrar la región a traducir como referencia (lastRegion en el selector)
      const located = toDipRect(this.region, all)
      const init: SelectorInit = { lastRegion: located?.rect ?? null, screen: { index: monitorIndex(all, display) + 1, total: all.length } }
      window.webContents.send(Channel.selectorInit, init)
    })
  }
}
