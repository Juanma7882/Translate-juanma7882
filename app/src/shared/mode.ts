// Modos de operación: lógica pura compartida por main, Ajustes y el overlay.

/** Lo que el usuario elige: `auto` traduce texto y pasa a audio si no hay; los otros fuerzan un modo. */
export type Mode = 'auto' | 'text' | 'audio'

/** Lo que está activo ahora mismo en una sesión en marcha. */
export type ActiveMode = 'text' | 'audio'

export const MODES: readonly Mode[] = ['auto', 'text', 'audio']

export const MODE_LABELS: Record<Mode, string> = {
  auto: 'Automático',
  text: 'Solo texto',
  audio: 'Solo audio',
}

/** Etiquetas del indicador del overlay (`paused` además de los modos activos). */
export const ACTIVE_LABELS: Record<ActiveMode | 'paused', string> = {
  text: 'Texto',
  audio: 'Audio',
  paused: 'Pausa',
}

/** Siguiente modo al alternar con el atajo: auto -> texto -> audio -> auto. */
export function nextMode(mode: Mode): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] as Mode
}

/** Qué modelos hacen falta para un modo (ámbito de `modelStatus`/`downloadModels`). */
export function scopeForMode(mode: Mode): 'text' | 'audio' | 'all' {
  return mode === 'auto' ? 'all' : mode
}

/** ¿El modo necesita una región elegida? Solo el audio puro no. */
export function needsRegion(mode: Mode): boolean {
  return mode !== 'audio'
}

/** Modo activo al empezar una sesión en `mode` (en auto siempre se empieza por texto). */
export function initialActive(mode: Mode): ActiveMode {
  return mode === 'audio' ? 'audio' : 'text'
}
