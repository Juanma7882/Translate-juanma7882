// Ajustes del usuario: tipos, valores por defecto y validación escrita a mano (sin dependencias).
//
// Solo contienen preferencias y la última región elegida: nunca contenido capturado ni traducido.
// Los mensajes de aviso nombran el campo, no su valor.

import { MODES } from './mode.ts'
import type { Mode } from './mode.ts'

export const SETTINGS_VERSION = 1

/** Región en píxeles físicos, relativa al monitor `monitor` (0 = principal): lo que entiende el motor. */
export interface SavedRegion {
  x: number
  y: number
  width: number
  height: number
  monitor: number
}

export interface OverlaySettings {
  /** 0.1 a 1. */
  opacity: number
  /** En píxeles, 10 a 96. */
  fontSize: number
  fontFamily: string
  /** Ancho de la ventana en píxeles, 200 a 3000. */
  width: number
  /** `auto`: fuera de la región; `manual`: en (`x`, `y`) de la pantalla. */
  placement: 'auto' | 'manual'
  x: number
  y: number
  /** Milisegundos sin traducciones nuevas antes de ocultar el texto (0 = no ocultar). */
  hideAfterMs: number
  showOriginal: boolean
}

export interface Shortcuts {
  selectRegion: string
  togglePause: string
  toggleMode: string
}

export interface Settings {
  version: typeof SETTINGS_VERSION
  from: string
  to: string
  engines: 'fake' | 'real'
  /** `auto`: texto y, si no hay, audio; `text` o `audio` fuerzan un modo. */
  mode: Mode
  /** Segundos sin texto en la región antes de pasar a audio (modo `auto`), 1 a 60. */
  fallbackSeconds: number
  /** Carpeta de modelos; `null` usa la de datos del usuario. */
  modelsDir: string | null
  lastRegion: SavedRegion | null
  overlay: OverlaySettings
  shortcuts: Shortcuts
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    from: 'en',
    to: 'es',
    engines: 'real',
    mode: 'auto',
    fallbackSeconds: 3,
    modelsDir: null,
    lastRegion: null,
    overlay: {
      opacity: 0.85,
      fontSize: 28,
      fontFamily: 'Arial, sans-serif',
      width: 900,
      placement: 'auto',
      x: 0,
      y: 0,
      hideAfterMs: 4000,
      showOriginal: true,
    },
    shortcuts: { selectRegion: 'CommandOrControl+Shift+T', togglePause: 'CommandOrControl+Shift+P', toggleMode: 'CommandOrControl+Shift+M' },
  }
}

export interface ParseResult {
  settings: Settings
  warnings: string[]
}

type Dict = Record<string, unknown>

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value)

const LANG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/
const FONT_PATTERN = /^[\w ,'"-]{1,120}$/u
const ACCELERATOR_PATTERN = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/

/** Lee un campo validado; si no es válido usa el valor por defecto y lo anota. */
class Reader {
  readonly warnings: string[] = []

  number(source: Dict, key: string, label: string, fallback: number, min: number, max: number, integer = false): number {
    const value = source[key]
    const ok = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
    if (value !== undefined && !ok) this.warnings.push(`invalid ${label}`)
    return ok ? value : fallback
  }

  boolean(source: Dict, key: string, label: string, fallback: boolean): boolean {
    const value = source[key]
    if (value !== undefined && typeof value !== 'boolean') this.warnings.push(`invalid ${label}`)
    return typeof value === 'boolean' ? value : fallback
  }

  pattern(source: Dict, key: string, label: string, fallback: string, pattern: RegExp): string {
    const value = source[key]
    const ok = typeof value === 'string' && pattern.test(value)
    if (value !== undefined && !ok) this.warnings.push(`invalid ${label}`)
    return ok ? value : fallback
  }

  oneOf<T extends string>(source: Dict, key: string, label: string, fallback: T, allowed: readonly T[]): T {
    const value = source[key]
    const ok = typeof value === 'string' && (allowed as readonly string[]).includes(value)
    if (value !== undefined && !ok) this.warnings.push(`invalid ${label}`)
    return ok ? (value as T) : fallback
  }

  section(source: Dict, key: string, label: string): Dict {
    const value = source[key]
    if (value !== undefined && !isDict(value)) this.warnings.push(`invalid ${label}`)
    return isDict(value) ? value : {}
  }
}

function readRegion(reader: Reader, value: unknown): SavedRegion | null {
  if (value === null || value === undefined) return null
  if (!isDict(value)) {
    reader.warnings.push('invalid lastRegion')
    return null
  }
  const before = reader.warnings.length
  const region = {
    x: reader.number(value, 'x', 'lastRegion.x', 0, -100_000, 100_000, true),
    y: reader.number(value, 'y', 'lastRegion.y', 0, -100_000, 100_000, true),
    width: reader.number(value, 'width', 'lastRegion.width', 0, 1, 100_000, true),
    height: reader.number(value, 'height', 'lastRegion.height', 0, 1, 100_000, true),
    monitor: reader.number(value, 'monitor', 'lastRegion.monitor', 0, 0, 64, true),
  }
  // Una región a medias no sirve: o está completa y válida o se descarta.
  const complete = region.width > 0 && region.height > 0 && ['x', 'y', 'width', 'height', 'monitor'].every((k) => k in value)
  if (reader.warnings.length > before || !complete) {
    if (reader.warnings.length === before) reader.warnings.push('invalid lastRegion')
    return null
  }
  return region
}

/** Valida cualquier cosa leída del disco o recibida por IPC; cada campo inválido vuelve a su valor por defecto. */
export function parseSettings(raw: unknown): ParseResult {
  const defaults = defaultSettings()
  if (!isDict(raw)) return { settings: defaults, warnings: ['settings are not an object'] }
  if (raw.version !== SETTINGS_VERSION) return { settings: defaults, warnings: ['unknown settings version'] }

  const reader = new Reader()
  const overlaySource = reader.section(raw, 'overlay', 'overlay')
  const shortcutSource = reader.section(raw, 'shortcuts', 'shortcuts')
  const d = defaults.overlay
  const modelsDirValue = raw.modelsDir
  const modelsDirOk = modelsDirValue === null || (typeof modelsDirValue === 'string' && modelsDirValue.length > 0 && modelsDirValue.length <= 1024)
  if (modelsDirValue !== undefined && !modelsDirOk) reader.warnings.push('invalid modelsDir')

  const settings: Settings = {
    version: SETTINGS_VERSION,
    from: reader.pattern(raw, 'from', 'from', defaults.from, LANG_PATTERN),
    to: reader.pattern(raw, 'to', 'to', defaults.to, LANG_PATTERN),
    engines: reader.oneOf(raw, 'engines', 'engines', defaults.engines, ['fake', 'real']),
    mode: reader.oneOf(raw, 'mode', 'mode', defaults.mode, MODES),
    fallbackSeconds: reader.number(raw, 'fallbackSeconds', 'fallbackSeconds', defaults.fallbackSeconds, 1, 60, true),
    modelsDir: modelsDirOk && modelsDirValue !== undefined ? (modelsDirValue as string | null) : defaults.modelsDir,
    lastRegion: readRegion(reader, raw.lastRegion),
    overlay: {
      opacity: reader.number(overlaySource, 'opacity', 'overlay.opacity', d.opacity, 0.1, 1),
      fontSize: reader.number(overlaySource, 'fontSize', 'overlay.fontSize', d.fontSize, 10, 96),
      fontFamily: reader.pattern(overlaySource, 'fontFamily', 'overlay.fontFamily', d.fontFamily, FONT_PATTERN),
      width: reader.number(overlaySource, 'width', 'overlay.width', d.width, 200, 3000, true),
      placement: reader.oneOf(overlaySource, 'placement', 'overlay.placement', d.placement, ['auto', 'manual']),
      x: reader.number(overlaySource, 'x', 'overlay.x', d.x, -100_000, 100_000, true),
      y: reader.number(overlaySource, 'y', 'overlay.y', d.y, -100_000, 100_000, true),
      hideAfterMs: reader.number(overlaySource, 'hideAfterMs', 'overlay.hideAfterMs', d.hideAfterMs, 0, 600_000, true),
      showOriginal: reader.boolean(overlaySource, 'showOriginal', 'overlay.showOriginal', d.showOriginal),
    },
    shortcuts: {
      selectRegion: reader.pattern(shortcutSource, 'selectRegion', 'shortcuts.selectRegion', defaults.shortcuts.selectRegion, ACCELERATOR_PATTERN),
      togglePause: reader.pattern(shortcutSource, 'togglePause', 'shortcuts.togglePause', defaults.shortcuts.togglePause, ACCELERATOR_PATTERN),
      toggleMode: reader.pattern(shortcutSource, 'toggleMode', 'shortcuts.toggleMode', defaults.shortcuts.toggleMode, ACCELERATOR_PATTERN),
    },
  }
  // Los idiomas no pueden coincidir: es una combinación sin sentido.
  if (settings.from === settings.to) {
    reader.warnings.push('from and to must differ')
    settings.from = defaults.from
    settings.to = defaults.to
  }
  return { settings, warnings: reader.warnings }
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object | null ? Partial<NonNullable<Settings[K]>> | null : Settings[K]
}

export type UpdateResult = { ok: true; settings: Settings } | { ok: false; errors: string[] }

/** Aplica un parche sobre los ajustes actuales; si algún campo es inválido no cambia nada. */
export function applyPatch(current: Settings, patch: unknown): UpdateResult {
  if (!isDict(patch)) return { ok: false, errors: ['the patch is not an object'] }
  const merged: Dict = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current) || key === 'version') return { ok: false, errors: [`unknown setting ${key}`] }
    const existing = (current as unknown as Dict)[key]
    merged[key] = isDict(existing) && isDict(value) ? { ...existing, ...value } : value
  }
  const { settings, warnings } = parseSettings(merged)
  return warnings.length > 0 ? { ok: false, errors: warnings } : { ok: true, settings }
}
