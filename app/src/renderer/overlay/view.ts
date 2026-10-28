// Qué muestra el overlay para un texto dado (lógica pura, sin DOM, para poder probarla).

import { luminance, parseHex } from '../../shared/contrast.ts'
import type { OverlayStyle, OverlayText } from '../../shared/ipc.ts'

/** Una línea del overlay: un subtítulo en un idioma. */
export interface OverlayLine {
  /** Código del idioma de la línea (atributo `lang` y etiqueta). */
  lang: string
  text: string
  kind: 'original' | 'translation'
  /** Original pequeño que acompaña a una o más traducciones. */
  secondary: boolean
}

export interface OverlayView {
  /** De arriba abajo: el original (si se muestra) y después las traducciones en el orden de los destinos. */
  lines: OverlayLine[]
  /** `true` mientras el subtítulo es provisional y no el definitivo. */
  provisional: boolean
  /** Con más de una línea se rotula el idioma de cada una. */
  labeled: boolean
}

/**
 * Las líneas para un texto. El original se muestra si su subtítulo está activo o si todavía no hay
 * ninguna traducción (parciales, destinos que fallaron): nunca queda el overlay en blanco.
 */
export function viewFor(text: OverlayText, style: Pick<OverlayStyle, 'showOriginal'>): OverlayView {
  const translations = text.translations.filter((t) => t.text.trim() !== '')
  const showOriginal = style.showOriginal || translations.length === 0
  const lines: OverlayLine[] = []
  if (showOriginal) lines.push({ lang: text.lang, text: text.original, kind: 'original', secondary: translations.length > 0 })
  for (const t of translations) lines.push({ lang: t.lang, text: t.text, kind: 'translation', secondary: false })
  return { lines, provisional: !text.final, labeled: lines.length > 1 }
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
