// Elegir dónde se muestran los subtítulos: abre el selector y devuelve el recuadro elegido en
// coordenadas de escritorio (DIP), que es lo que usa el overlay en su colocación manual.

import { ipcMain, screen } from 'electron'
import type { BrowserWindow, IpcMainEvent } from 'electron'

import { monitorIndex, toDipRect } from '../shared/geometry.ts'
import type { DisplayInfo } from '../shared/geometry.ts'
import { Channel } from '../shared/ipc.ts'
import type { DipRect, SelectorInit } from '../shared/ipc.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { WindowManager } from './windows.ts'

/** Recuadro de los subtítulos en el escritorio (DIP). */
export interface OverlayPosition {
  x: number
  y: number
  width: number
}

export interface DisplaySource {
  all(): DisplayInfo[]
  underCursor(): DisplayInfo
}

const NEXT_DISPLAY = Symbol('next-display')
const PREVIEW_MS = 2500

const contains = (d: DisplayInfo, p: { x: number; y: number }): boolean =>
  p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height

const toLocal = (rect: DipRect, d: DisplayInfo): DipRect => ({ x: rect.x - d.bounds.x, y: rect.y - d.bounds.y, width: rect.width, height: rect.height })

export class OverlayPicker {
  private readonly windows: WindowManager
  private readonly displays: DisplaySource
  private readonly region: SavedRegion
  /** Recuadro actual de los subtítulos (escritorio), si tienen posición manual. */
  private readonly current: DipRect | null
  private pending: Promise<OverlayPosition | null> | null = null

  constructor(windows: WindowManager, displays: DisplaySource, region: SavedRegion, current: DipRect | null) {
    this.windows = windows
    this.displays = displays
    this.region = region
    this.current = current
  }

  /** Abre el selector en la pantalla de los subtítulos (o de la región). Resuelve `null` si se cancela. */
  pick(): Promise<OverlayPosition | null> {
    this.pending ??= this.loop(this.startDisplay()).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /** Marca unos segundos el recuadro actual de los subtítulos, sin aceptar ratón ni teclado. */
  async preview(): Promise<boolean> {
    if (this.pending || !this.current) return false
    const all = this.displays.all()
    const center = { x: this.current.x + this.current.width / 2, y: this.current.y + this.current.height / 2 }
    const display = all.find((d) => contains(d, center))
    const electronDisplay = display && screen.getAllDisplays().find((d) => d.id === display.id)
    if (!display || !electronDisplay) return false

    // Una ventana de selector que siga abierta (otra vista previa) se reutilizaría con su estado: se cierra antes.
    this.windows.close('selector')
    const window = await this.windows.openSelector(electronDisplay)
    window.setIgnoreMouseEvents(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    const init: SelectorInit = { lastRegion: toLocal(this.current, display), screen: { index: monitorIndex(all, display) + 1, total: all.length }, preview: true, purpose: 'overlay' }
    window.webContents.send(Channel.selectorInit, init)
    // Solo cierra esta ventana: si entretanto se abrió un selector, no lo toca.
    const timer = setTimeout(() => {
      if (this.windows.get('selector') === window) this.windows.close('selector')
    }, PREVIEW_MS)
    window.once('closed', () => clearTimeout(timer))
    return true
  }

  private startDisplay(): DisplayInfo {
    const all = this.displays.all()
    if (this.current) {
      const at = all.find((d) => contains(d, { x: this.current!.x + this.current!.width / 2, y: this.current!.y + this.current!.height / 2 }))
      if (at) return at
    }
    return toDipRect(this.region, all)?.display ?? this.displays.underCursor()
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

    // Una vista previa abierta dejaría la ventana atravesable y su temporizador la cerraría a mitad de elegir.
    this.windows.close('selector')
    let window: BrowserWindow
    try {
      window = await this.windows.openSelector(electronDisplay)
    } catch (error) {
      if (this.windows.get('selector') === undefined) return null
      throw error
    }
    window.setIgnoreMouseEvents(false)
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
      const fromThisWindow = (event: IpcMainEvent): boolean => event.sender === window.webContents

      const onConfirm = (event: IpcMainEvent, rect: DipRect): void => {
        if (!fromThisWindow(event)) return
        finish({ x: Math.round(display.bounds.x + rect.x), y: Math.round(display.bounds.y + rect.y), width: Math.round(rect.width) })
      }
      const onCancel = (event: IpcMainEvent): void => {
        if (fromThisWindow(event)) finish(null)
      }
      const onNext = (event: IpcMainEvent): void => {
        if (fromThisWindow(event) && all.length > 1) finish(NEXT_DISPLAY)
      }
      ipcMain.on(Channel.selectorConfirm, onConfirm)
      ipcMain.on(Channel.selectorCancel, onCancel)
      ipcMain.on(Channel.selectorNextDisplay, onNext)
      window.once('closed', () => finish(null))

      // Recuadro previo = posición actual de los subtítulos (Enter la conserva), nunca la región a traducir.
      const onThis = this.current && contains(display, { x: this.current.x + this.current.width / 2, y: this.current.y + this.current.height / 2 })
      const init: SelectorInit = {
        lastRegion: onThis && this.current ? toLocal(this.current, display) : null,
        screen: { index: monitorIndex(all, display) + 1, total: all.length },
        purpose: 'overlay',
      }
      window.webContents.send(Channel.selectorInit, init)
    })
  }
}
