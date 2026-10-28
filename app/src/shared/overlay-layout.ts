// Geometría del overlay: cuánto mide la ventana y cuántas líneas tiene cada subtítulo.
//
// Con dos subtítulos de `maxLines` líneas cada uno el overlay podría no caber en pantalla (fuente
// grande, muchas líneas). `linesPerTrack` baja las líneas de cada subtítulo, sin pasar de una, hasta
// que el conjunto cabe en una fracción del alto útil; el ajuste del usuario no se toca.

/** Interlineado del cuadro (`line-height` del CSS del overlay). */
export const LINE_HEIGHT = 1.3
/** Tamaño relativo del subtítulo secundario (el original cuando va acompañado de traducciones). */
export const SECONDARY_SCALE = 0.7
/** Líneas máximas del subtítulo secundario. */
export const SECONDARY_LINES = 2
/** Fracción máxima del alto útil de la pantalla que puede ocupar el overlay. */
export const MAX_SCREEN_FRACTION = 0.45

const PADDING = 20
const MODE_LABEL_EM = 0.45 * LINE_HEIGHT
const MODE_LABEL_MARGIN = 4
const TRACK_GAP = 2
const SAFETY = 6

/** Qué subtítulos hay: los principales (las traducciones, o el original si va solo) y un secundario. */
export interface TrackPlan {
  /** Subtítulos a tamaño normal. */
  primary: number
  /** Hay un original pequeño sobre las traducciones. */
  secondary: boolean
}

/** El plan a partir de los ajustes: sin destinos, el original es el único (y principal) subtítulo. */
export function trackPlan(targets: readonly string[], showOriginal: boolean): TrackPlan {
  if (targets.length === 0) return { primary: 1, secondary: false }
  return { primary: targets.length, secondary: showOriginal }
}

/** Alto de la ventana para `lines` líneas en cada subtítulo principal, en píxeles. */
/**
 * Milisegundos tras los que el overlay oculta el texto (0 = no ocultar). Con «mantener la traducción»
 * y en modo texto no se oculta por tiempo: la retiran el aviso de región sin texto o la traducción
 * siguiente. En audio (y fuera de sesión) vale el tiempo configurado.
 */
export function effectiveHideAfterMs(hideAfterMs: number, keepWhileUnchanged: boolean, textMode: boolean): number {
  return keepWhileUnchanged && textMode ? 0 : hideAfterMs
}

export function overlayHeight(fontSize: number, lines: number, plan: TrackPlan): number {
  const secondary = plan.secondary ? fontSize * SECONDARY_SCALE * LINE_HEIGHT * SECONDARY_LINES : 0
  const primary = fontSize * LINE_HEIGHT * lines * plan.primary
  const label = fontSize * MODE_LABEL_EM + MODE_LABEL_MARGIN
  const gaps = Math.max(0, plan.primary + (plan.secondary ? 1 : 0) - 1) * TRACK_GAP
  return Math.ceil(PADDING + label + secondary + primary + gaps + SAFETY)
}

/**
 * Líneas efectivas de cada subtítulo principal: las pedidas (`maxLines`) mientras el overlay quepa en
 * `MAX_SCREEN_FRACTION` del alto útil `workHeight`; si no, las que quepan, con un mínimo de una.
 */
export function linesPerTrack(fontSize: number, maxLines: number, plan: TrackPlan, workHeight: number): number {
  const cap = workHeight * MAX_SCREEN_FRACTION
  let lines = Math.max(1, Math.floor(maxLines))
  while (lines > 1 && overlayHeight(fontSize, lines, plan) > cap) lines--
  return lines
}
