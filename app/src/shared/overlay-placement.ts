// Dónde poner el overlay para que no tape la región traducida (y el OCR no lea su propio texto).

import type { DipRect } from './ipc.ts'

export interface Placement {
  x: number
  y: number
  /** `true` si no hubo forma de evitar que el overlay tape parte de la región. */
  overlaps: boolean
}

/** Separación por defecto entre la región y el overlay, en DIP. */
export const DEFAULT_GAP = 12

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

function intersects(a: DipRect, b: DipRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Posición de un overlay de `size` para `region` dentro de `workArea` (todo en DIP del escritorio).
 * Se prefiere debajo de la región, después encima y, si la región ocupa casi toda la pantalla,
 * el lado con más espacio. Siempre queda centrado sobre la región y dentro del área de trabajo.
 */
export function placeOutside(
  region: DipRect,
  workArea: DipRect,
  size: { width: number; height: number },
  gap = DEFAULT_GAP,
): Placement {
  const x = clamp(region.x + region.width / 2 - size.width / 2, workArea.x, workArea.x + workArea.width - size.width)
  const belowY = region.y + region.height + gap
  const aboveY = region.y - gap - size.height
  const bottom = workArea.y + workArea.height
  const fitsBelow = belowY + size.height <= bottom
  const fitsAbove = aboveY >= workArea.y

  let y: number
  if (fitsBelow) y = belowY
  else if (fitsAbove) y = aboveY
  else {
    // No cabe a ningún lado: el lado con más espacio, pegado al borde del área de trabajo.
    const spaceBelow = bottom - (region.y + region.height)
    const spaceAbove = region.y - workArea.y
    y = spaceBelow >= spaceAbove ? bottom - size.height : workArea.y
  }
  y = clamp(y, workArea.y, bottom - size.height)
  return { x, y, overlaps: intersects({ x, y, ...size }, region) }
}

/** Visible mínimo (en DIP) de un overlay arrastrado: siempre queda un trozo al alcance del ratón. */
export const MIN_VISIBLE = 48

/**
 * Mantiene un overlay arrastrado dentro del escritorio (la caja que envuelve a todas las áreas de
 * trabajo): el borde superior nunca sale de la pantalla y siempre quedan `MIN_VISIBLE` píxeles
 * visibles a cada lado.
 */
export function clampToAreas(rect: DipRect, areas: readonly DipRect[], minVisible = MIN_VISIBLE): { x: number; y: number } {
  if (areas.length === 0) return { x: rect.x, y: rect.y }
  const left = Math.min(...areas.map((a) => a.x))
  const top = Math.min(...areas.map((a) => a.y))
  const right = Math.max(...areas.map((a) => a.x + a.width))
  const bottom = Math.max(...areas.map((a) => a.y + a.height))
  return {
    x: clamp(rect.x, left - rect.width + minVisible, right - minVisible),
    y: clamp(rect.y, top, bottom - minVisible),
  }
}
