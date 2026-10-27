// Geometría de pantallas: de píxeles de interfaz (DIP) a la región física que entiende el motor.
//
// Convención (la misma que `tr-adapters::screen::geometry`): una región es física y relativa al
// monitor indicado; el monitor 0 es el principal y el resto se ordena por posición.

import type { DipRect } from './ipc.ts'
import type { SavedRegion } from './settings.ts'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Lo que se necesita de un `Electron.Display` (se puede construir a mano en los tests). */
export interface DisplayInfo {
  id: number
  /** Posición y tamaño en el escritorio virtual, en DIP. */
  bounds: Box
  /** Área sin barras del sistema (barra de tareas, dock...), en DIP. */
  workArea: Box
  /** Píxeles físicos por DIP. */
  scaleFactor: number
  isPrimary: boolean
}

/** Lado mínimo (DIP) de una selección para que pueda contener texto. */
export const MIN_SELECTION_DIP = 12

/** Orden estable de monitores: primero el principal; después por (x, y). */
export function orderDisplays(displays: readonly DisplayInfo[]): DisplayInfo[] {
  return displays
    .map((display, index) => ({ display, index }))
    .sort((a, b) => {
      if (a.display.isPrimary !== b.display.isPrimary) return a.display.isPrimary ? -1 : 1
      return a.display.bounds.x - b.display.bounds.x || a.display.bounds.y - b.display.bounds.y || a.index - b.index
    })
    .map((entry) => entry.display)
}

/** Índice de `target` en el orden de [`orderDisplays`], o -1 si no está. */
export function monitorIndex(displays: readonly DisplayInfo[], target: DisplayInfo): number {
  return orderDisplays(displays).findIndex((d) => d.id === target.id)
}

/** Región física de una selección hecha sobre `display`; `null` si es demasiado pequeña o queda fuera. */
export function toPhysicalRegion(dip: DipRect, display: DisplayInfo, displays: readonly DisplayInfo[]): SavedRegion | null {
  const monitor = monitorIndex(displays, display)
  if (monitor < 0) return null

  // Se recorta a la pantalla (en DIP) antes de escalar.
  const left = Math.max(0, dip.x)
  const top = Math.max(0, dip.y)
  const right = Math.min(display.bounds.width, dip.x + dip.width)
  const bottom = Math.min(display.bounds.height, dip.y + dip.height)
  if (right - left < MIN_SELECTION_DIP || bottom - top < MIN_SELECTION_DIP) return null

  // Se redondean los bordes (no el ancho) para que dos selecciones contiguas no dejen huecos.
  const scale = display.scaleFactor
  const x = Math.round(left * scale)
  const y = Math.round(top * scale)
  return {
    x,
    y,
    width: Math.max(1, Math.round(right * scale) - x),
    height: Math.max(1, Math.round(bottom * scale) - y),
    monitor,
  }
}

/** Inverso de [`toPhysicalRegion`]: la región guardada, en DIP sobre su monitor. `null` si ya no existe. */
export function toDipRect(region: SavedRegion, displays: readonly DisplayInfo[]): { display: DisplayInfo; rect: DipRect } | null {
  const display = orderDisplays(displays)[region.monitor]
  if (!display) return null
  const scale = display.scaleFactor
  return {
    display,
    rect: { x: region.x / scale, y: region.y / scale, width: region.width / scale, height: region.height / scale },
  }
}

/** La región guardada en coordenadas DIP del escritorio virtual (con el desplazamiento del monitor). */
export function toDesktopDip(region: SavedRegion, displays: readonly DisplayInfo[]): { display: DisplayInfo; rect: DipRect } | null {
  const local = toDipRect(region, displays)
  if (!local) return null
  const { x, y } = local.display.bounds
  return { display: local.display, rect: { ...local.rect, x: local.rect.x + x, y: local.rect.y + y } }
}
