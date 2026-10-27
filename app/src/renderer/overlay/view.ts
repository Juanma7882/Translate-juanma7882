// Qué muestra el overlay para un texto dado (lógica pura, sin DOM, para poder probarla).

import type { OverlayStyle, OverlayText } from '../../shared/ipc.ts'

export interface OverlayView {
  /** Línea pequeña con el texto original; vacía si no debe mostrarse. */
  original: string
  /** Línea principal: la traducción o, si todavía no hay (parciales), el original. */
  main: string
  /** `true` mientras el subtítulo es provisional y no el definitivo. */
  provisional: boolean
}

export function viewFor(text: OverlayText, style: Pick<OverlayStyle, 'showOriginal'>): OverlayView {
  const hasTranslation = text.translated !== null && text.translated.trim() !== ''
  return {
    original: style.showOriginal && hasTranslation ? text.original : '',
    main: hasTranslation ? (text.translated as string) : text.original,
    provisional: !text.final,
  }
}
