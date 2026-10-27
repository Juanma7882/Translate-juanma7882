// Interacción del selector de región como máquina de estados pura (sin DOM), para poder probarla.

import { MIN_SELECTION_DIP } from '../../shared/geometry.ts'
import type { DipRect } from '../../shared/ipc.ts'

export interface Point {
  x: number
  y: number
}

export interface SelectionState {
  /** Punto donde empezó el arrastre; `null` si no se está arrastrando. */
  start: Point | null
  current: Point | null
  /** Región elegida la vez anterior, si hay. */
  previous: DipRect | null
}

export type SelectionInput =
  | { type: 'down'; point: Point }
  | { type: 'move'; point: Point }
  | { type: 'up'; point: Point }
  | { type: 'key'; key: string }
  | { type: 'context' }

export type SelectionEffect = { type: 'confirm'; rect: DipRect } | { type: 'cancel' } | null

export interface SelectionStep {
  state: SelectionState
  effect: SelectionEffect
}

export function initialState(previous: DipRect | null): SelectionState {
  return { start: null, current: null, previous }
}

/** Rectángulo normalizado entre dos esquinas cualesquiera. */
export function normalize(a: Point, b: Point): DipRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function isDragging(state: SelectionState): boolean {
  return state.start !== null
}

/** Qué dibujar: el rectángulo del arrastre en curso o, si no hay, la región anterior. */
export function visibleRect(state: SelectionState): { rect: DipRect; previous: boolean } | null {
  if (state.start && state.current) return { rect: normalize(state.start, state.current), previous: false }
  return state.previous ? { rect: state.previous, previous: true } : null
}

const big = (rect: DipRect): boolean => rect.width >= MIN_SELECTION_DIP && rect.height >= MIN_SELECTION_DIP

export function reduce(state: SelectionState, input: SelectionInput): SelectionStep {
  switch (input.type) {
    case 'down':
      return { state: { ...state, start: input.point, current: input.point }, effect: null }
    case 'move':
      return state.start ? { state: { ...state, current: input.point }, effect: null } : { state, effect: null }
    case 'up': {
      if (!state.start) return { state, effect: null }
      const rect = normalize(state.start, input.point)
      const idle = { ...state, start: null, current: null }
      // Un clic sin arrastre (o una selección diminuta) no confirma nada: la ventana sigue abierta.
      return big(rect) ? { state: idle, effect: { type: 'confirm', rect } } : { state: idle, effect: null }
    }
    case 'key':
      if (input.key === 'Escape') return { state, effect: { type: 'cancel' } }
      if (input.key === 'Enter' && !state.start && state.previous && big(state.previous)) {
        return { state, effect: { type: 'confirm', rect: state.previous } }
      }
      return { state, effect: null }
    case 'context':
      return { state, effect: { type: 'cancel' } }
  }
}
