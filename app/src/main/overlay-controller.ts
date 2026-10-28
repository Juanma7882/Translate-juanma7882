// Overlay de traducción: ventana transparente, siempre encima y sin estorbar al ratón ni al teclado.
//
// Se ubica fuera de la región traducida (para que el OCR no lea su propio texto) y, donde el
// sistema lo permite, se excluye de las capturas de pantalla. Apariencia y posición se actualizan
// en vivo cuando cambian los ajustes.

import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'

import { toDesktopDip } from '../shared/geometry.ts'
import type { DipRect, OverlayMode, OverlayStyle, OverlayText } from '../shared/ipc.ts'
import { Channel } from '../shared/ipc.ts'
import { clampToAreas, placeOutside } from '../shared/overlay-placement.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { DisplaySource } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** Alto de la ventana: espacio para el original y hasta `maxLines` líneas de traducción. */
export function overlayHeight(fontSize: number, maxLines = 2): number {
  return Math.ceil(fontSize * 1.35 * (maxLines + 1) + 36)
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
  /** El modo "mover" se activó (`true`) o terminó (`false`). */
  moving: [boolean]
}

export class OverlayController extends EventEmitter<OverlayEvents> {
  private readonly windows: WindowManager
  private readonly settings: SettingsStore
  private readonly displays: DisplaySource
  private region: SavedRegion | null = null
  private overlapping = false
  private moveMode = false
  /** Posición durante un arrastre (fracciones acumuladas; la ventana usa enteros). */
  private dragAt: { x: number; y: number } | null = null
  private openedForMove = false

  constructor(windows: WindowManager, settings: SettingsStore, displays: DisplaySource) {
    super()
    this.windows = windows
    this.settings = settings
    this.displays = displays
    settings.onChange(() => {
      this.applyStyle()
      // Durante un arrastre la ventana la mueve el usuario, no los ajustes.
      if (!this.moveMode) this.place()
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
    if (this.moveMode) window.setIgnoreMouseEvents(false)
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

  /** Indicador del modo activo; viaja solo el nombre del modo. */
  setMode(mode: OverlayMode): void {
    this.window?.webContents.send(Channel.overlayMode, mode)
  }

  clear(): void {
    this.window?.webContents.send(Channel.overlayClear)
  }

  close(): void {
    this.moveMode = false
    this.dragAt = null
    this.windows.close('overlay')
  }

  get moving(): boolean {
    return this.moveMode
  }

  /**
   * Entra en el modo "mover": el overlay (abierto si hace falta) deja de ser atravesable y muestra
   * un asa para arrastrarlo. Solo así acepta el ratón; fuera de este modo ignora todo.
   */
  async beginMove(): Promise<void> {
    if (this.moveMode) return
    if (!this.window) {
      this.openedForMove = true
      await this.open(this.region)
    }
    const window = this.window
    if (!window) return
    this.moveMode = true
    this.dragAt = null
    window.setIgnoreMouseEvents(false)
    window.webContents.send(Channel.overlayMoveMode, true)
    this.emit('moving', true)
  }

  /** Desplaza la ventana `dx`, `dy` píxeles de interfaz; sin el modo "mover" activo no hace nada. */
  moveBy(dx: number, dy: number): void {
    const window = this.window
    if (!this.moveMode || !window || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const bounds = window.getBounds()
    const from = this.dragAt ?? { x: bounds.x, y: bounds.y }
    const areas = this.displays.all().map((d) => d.workArea)
    const next = clampToAreas({ x: from.x + dx, y: from.y + dy, width: bounds.width, height: bounds.height }, areas)
    this.dragAt = next
    window.setBounds({ ...bounds, x: Math.round(next.x), y: Math.round(next.y) })
  }

  /** Termina el modo "mover" y guarda la posición como manual (si el usuario movió el overlay). */
  endMove(): void {
    if (!this.moveMode) return
    const window = this.window
    const moved = this.dragAt
    this.moveMode = false
    this.dragAt = null
    if (window) {
      window.setIgnoreMouseEvents(true, { forward: true })
      window.webContents.send(Channel.overlayMoveMode, false)
    }
    this.emit('moving', false)
    if (moved) {
      const x = Math.round(moved.x)
      const y = Math.round(moved.y)
      this.settings.update({ overlay: { placement: 'manual', x, y } })
    }
  }

  /** `true` si el overlay se abrió solo para moverlo (hay que cerrarlo al terminar si no hay sesión). */
  consumeOpenedForMove(): boolean {
    const value = this.openedForMove
    this.openedForMove = false
    return value
  }

  private applyStyle(): void {
    const { opacity, fontSize, fontFamily, showOriginal, hideAfterMs, textColor, backgroundColor, maxLines } = this.settings.get().overlay
    const style: OverlayStyle = { opacity, fontSize, fontFamily, showOriginal, hideAfterMs, textColor, backgroundColor, maxLines }
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
    const height = Math.min(overlayHeight(overlay.fontSize, overlay.maxLines), work.height)
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
