// Qué muestra el overlay para un texto dado (lógica pura, sin DOM, para poder probarla).

import { luminance, parseHex } from '../../shared/contrast.ts'
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

/** Cuánto se muestra la etiqueta de modo por sí sola tras un cambio de modo. */
export const MODE_FLASH_MS = 2500

/** Variables CSS que reflejan el estilo (la ventana solo usa estas; ningún valor llega como HTML). */
export function cssVariables(style: OverlayStyle): Record<string, string> {
  const [r, g, b] = parseHex(style.backgroundColor)
  return {
    '--opacity': String(style.opacity),
    '--font-size': `${style.fontSize}px`,
    '--font-family': style.fontFamily,
    '--text-color': style.textColor,
    '--bg-rgb': `${r}, ${g}, ${b}`,
    // Sombra del color opuesto al texto: se lee tanto con texto claro como oscuro.
    '--shadow-color': luminance(style.textColor) > 0.5 ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.7)',
    '--max-lines': String(style.maxLines),
  }
}

/** Texto de ejemplo del modo "mover", cuando todavía no hay ninguna traducción. */
export const MOVE_PLACEHOLDER = 'Aquí aparecerá la traducción'
