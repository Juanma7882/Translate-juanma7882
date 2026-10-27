// Overlay de traducción: ventana transparente, siempre encima y sin estorbar al ratón ni al teclado.
//
// Se ubica fuera de la región traducida (para que el OCR no lea su propio texto) y, donde el
// sistema lo permite, se excluye de las capturas de pantalla. Apariencia y posición se actualizan
// en vivo cuando cambian los ajustes.

import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'

import { toDesktopDip } from '../shared/geometry.ts'
import type { DipRect, OverlayStyle, OverlayText } from '../shared/ipc.ts'
import { Channel } from '../shared/ipc.ts'
import { placeOutside } from '../shared/overlay-placement.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { DisplaySource } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** Alto de la ventana: espacio para el original y hasta dos líneas de traducción. */
export function overlayHeight(fontSize: number): number {
  return Math.ceil(fontSize * 1.35 * 3 + 36)
}

/** Propiedades que hacen del overlay una capa que no se interpone: encima, sin foco, atravesable. */
export function hardenOverlay(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setFocusable(false)
  window.setIgnoreMouseEvents(true, { forward: true })
  // Excluye la ventana de las capturas (Windows y macOS); en Linux no tiene efecto.
  window.setContentProtection(true)
  // Visible también sobre aplicaciones a pantalla completa (macOS).
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

interface OverlayEvents {
  /** `true` si el overlay tapa la región traducida (el OCR podría leer su propio texto). */
  overlap: [boolean]
}

export class OverlayController extends EventEmitter<OverlayEvents> {
  private readonly windows: WindowManager
  private readonly settings: SettingsStore
  private readonly displays: DisplaySource
  private region: SavedRegion | null = null
  private overlapping = false

  constructor(windows: WindowManager, settings: SettingsStore, displays: DisplaySource) {
    super()
    this.windows = windows
    this.settings = settings
    this.displays = displays
    settings.onChange(() => {
      this.applyStyle()
      this.place()
    })
  }

  get overlapsRegion(): boolean {
    return this.overlapping
  }

  private get window(): BrowserWindow | undefined {
    return this.windows.get('overlay')
  }

  /** Abre el overlay para `region` (o `null` si todavía no hay región). */
  async open(region: SavedRegion | null): Promise<BrowserWindow> {
    this.region = region
    const window = await this.windows.openOverlay({ show: false })
    hardenOverlay(window)
    this.applyStyle()
    this.place()
    if (!window.isVisible()) window.showInactive()
    return window
  }

  /** Cambia la región de referencia (p. ej. tras elegir otra) y recoloca el overlay. */
  setRegion(region: SavedRegion | null): void {
    this.region = region
    this.place()
  }

  show(text: OverlayText): void {
    this.window?.webContents.send(Channel.overlayShow, text)
  }

  clear(): void {
    this.window?.webContents.send(Channel.overlayClear)
  }

  close(): void {
    this.windows.close('overlay')
  }

  private applyStyle(): void {
    const { opacity, fontSize, fontFamily, showOriginal, hideAfterMs } = this.settings.get().overlay
    const style: OverlayStyle = { opacity, fontSize, fontFamily, showOriginal, hideAfterMs }
    this.window?.webContents.send(Channel.overlayStyle, style)
  }

  private place(): void {
    const window = this.window
    if (!window) return
    const overlay = this.settings.get().overlay
    const all = this.displays.all()
    const desktop = this.region ? toDesktopDip(this.region, all) : null
    const display = desktop?.display ?? all.find((d) => d.isPrimary) ?? all[0]
    if (!display) return

    const work = display.workArea
    const width = Math.min(overlay.width, work.width)
    const height = Math.min(overlayHeight(overlay.fontSize), work.height)
    let x: number
    let y: number
    let overlaps = false

    if (overlay.placement === 'manual') {
      ;({ x, y } = overlay)
      if (desktop) overlaps = intersects({ x, y, width, height }, desktop.rect)
    } else if (desktop) {
      ;({ x, y, overlaps } = placeOutside(desktop.rect, work, { width, height }))
    } else {
      // Sin región todavía: abajo y centrado en el monitor principal.
      x = work.x + (work.width - width) / 2
      y = work.y + work.height - height - 48
    }

    window.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
    if (overlaps !== this.overlapping) {
      this.overlapping = overlaps
      this.emit('overlap', overlaps)
    }
  }
}

function intersects(a: DipRect, b: DipRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
