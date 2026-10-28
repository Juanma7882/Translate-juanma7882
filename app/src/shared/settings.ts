// Ajustes del usuario: tipos, valores por defecto y validación escrita a mano (sin dependencias).
//
// Solo contienen preferencias y la última región elegida: nunca contenido capturado ni traducido.
// Los mensajes de aviso nombran el campo, no su valor.

import { hasEnoughContrast } from './contrast.ts'
import type { AudioSourceChoice } from './ipc.ts'
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
  /** Color del texto, `#rrggbb`. */
  textColor: string
  /** Color de fondo, `#rrggbb` (la opacidad se aplica aparte). Con el texto, contraste mínimo 4,5:1. */
  backgroundColor: string
  /** Líneas de traducción visibles, 1 a 6. */
  maxLines: number
}

/** Parámetros de rendimiento; `0` = automático (el motor usa su valor por defecto). */
export interface PerformanceSettings {
  /** Hilos de cada sesión de ONNX Runtime, 0 (auto) o 1 a 64. */
  intraThreads: number
  /** Anchura del haz de traducción, 0 (por defecto) o 1 a 8. */
  beamWidth: number
  /** Entradas de la caché de traducciones, 0 (por defecto) o 16 a 1 000 000. */
  cacheCapacity: number
  /** Lado máximo de detección del OCR en píxeles, 0 (por defecto, 960) o 160 a 4000. */
  ocrMaxSide: number
  /** Prioriza la RAM sobre la latencia. */
  lowMemory: boolean
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
  /** Fuente del audio: todo el sistema o una aplicación (por nombre de programa, nunca por PID). */
  audioSource: AudioSourceChoice
  /** Nivel RMS (0 a 1) a partir del cual el audio cuenta como voz: 0 (por defecto del motor) o 0,001 a 0,5. */
  voiceThreshold: number
  /** Carpeta de modelos; `null` usa la de datos del usuario. */
  modelsDir: string | null
  lastRegion: SavedRegion | null
  overlay: OverlaySettings
  shortcuts: Shortcuts
  performance: PerformanceSettings
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    from: 'en',
    to: 'es',
    engines: 'real',
    mode: 'auto',
    fallbackSeconds: 3,
    audioSource: { kind: 'system' },
    voiceThreshold: 0,
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
      textColor: '#ffffff',
      backgroundColor: '#0c0c10',
      maxLines: 2,
    },
    performance: { intraThreads: 0, beamWidth: 0, cacheCapacity: 0, ocrMaxSide: 0, lowMemory: false },
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
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
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

/** La caché es 0 (por defecto) o un entero entre 16 y 1 000 000. */
function readCache(reader: Reader, source: Dict): number {
  const value = source['cacheCapacity']
  if (value === 0) return 0
  return reader.number(source, 'cacheCapacity', 'performance.cacheCapacity', 0, 16, 1_000_000, true)
}

/** El lado de detección es 0 (por defecto) o un entero entre 160 y 4000. */
function readOcrSide(reader: Reader, source: Dict): number {
  if (source['ocrMaxSide'] === 0) return 0
  return reader.number(source, 'ocrMaxSide', 'performance.ocrMaxSide', 0, 160, 4000, true)
}

export const MIN_VOICE_THRESHOLD = 0.001
export const MAX_VOICE_THRESHOLD = 0.5

/** El umbral de voz es 0 (por defecto) o un nivel RMS entre 0,001 y 0,5. */
function readVoiceThreshold(reader: Reader, source: Dict): number {
  if (source['voiceThreshold'] === 0) return 0
  return reader.number(source, 'voiceThreshold', 'voiceThreshold', 0, MIN_VOICE_THRESHOLD, MAX_VOICE_THRESHOLD)
}

/** Longitud máxima del nombre de un programa. */
export const MAX_PROGRAM_LENGTH = 128
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_PROGRAM = /[\\/:*?"<>|\u0000-\u001f\u007f]/u

/** Un nombre de programa (`firefox.exe`), no una ruta: sin separadores, unidades ni caracteres de control. */
export function isProgramName(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_PROGRAM_LENGTH) return false
  if (value !== value.trim() || value === '.' || value === '..') return false
  // Sin separadores de ruta ni caracteres reservados o de control.
  return !FORBIDDEN_IN_PROGRAM.test(value)
}

function readAudioSource(reader: Reader, value: unknown): AudioSourceChoice {
  if (value === undefined) return { kind: 'system' }
  if (isDict(value)) {
    const keys = Object.keys(value)
    if (value['kind'] === 'system' && keys.length === 1) return { kind: 'system' }
    if (value['kind'] === 'app' && keys.length === 2 && isProgramName(value['program'])) return { kind: 'app', program: value['program'] }
  }
  reader.warnings.push('invalid audioSource')
  return { kind: 'system' }
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
  const performanceSource = reader.section(raw, 'performance', 'performance')
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
    audioSource: readAudioSource(reader, raw.audioSource),
    voiceThreshold: readVoiceThreshold(reader, raw),
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
      textColor: reader.pattern(overlaySource, 'textColor', 'overlay.textColor', d.textColor, COLOR_PATTERN).toLowerCase(),
      backgroundColor: reader.pattern(overlaySource, 'backgroundColor', 'overlay.backgroundColor', d.backgroundColor, COLOR_PATTERN).toLowerCase(),
      maxLines: reader.number(overlaySource, 'maxLines', 'overlay.maxLines', d.maxLines, 1, 6, true),
    },
    performance: {
      intraThreads: reader.number(performanceSource, 'intraThreads', 'performance.intraThreads', 0, 0, 64, true),
      beamWidth: reader.number(performanceSource, 'beamWidth', 'performance.beamWidth', 0, 0, 8, true),
      cacheCapacity: readCache(reader, performanceSource),
      ocrMaxSide: readOcrSide(reader, performanceSource),
      lowMemory: reader.boolean(performanceSource, 'lowMemory', 'performance.lowMemory', false),
    },
    shortcuts: {
      selectRegion: reader.pattern(shortcutSource, 'selectRegion', 'shortcuts.selectRegion', defaults.shortcuts.selectRegion, ACCELERATOR_PATTERN),
      togglePause: reader.pattern(shortcutSource, 'togglePause', 'shortcuts.togglePause', defaults.shortcuts.togglePause, ACCELERATOR_PATTERN),
      toggleMode: reader.pattern(shortcutSource, 'toggleMode', 'shortcuts.toggleMode', defaults.shortcuts.toggleMode, ACCELERATOR_PATTERN),
    },
  }
  if (!hasEnoughContrast(settings.overlay.textColor, settings.overlay.backgroundColor)) {
    reader.warnings.push('invalid overlay.contrast')
    settings.overlay.textColor = d.textColor
    settings.overlay.backgroundColor = d.backgroundColor
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
  [K in Exclude<keyof Settings, 'audioSource'>]?: Settings[K] extends object | null ? Partial<NonNullable<Settings[K]>> | null : Settings[K]
} & { audioSource?: AudioSourceChoice }

export type UpdateResult = { ok: true; settings: Settings } | { ok: false; errors: string[] }

/** Aplica un parche sobre los ajustes actuales; si algún campo es inválido no cambia nada. */
export function applyPatch(current: Settings, patch: unknown): UpdateResult {
  if (!isDict(patch)) return { ok: false, errors: ['the patch is not an object'] }
  const merged: Dict = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current) || key === 'version') return { ok: false, errors: [`unknown setting ${key}`] }
    const existing = (current as unknown as Dict)[key]
    // `audioSource` es una unión: se sustituye entera para no arrastrar `program` al pasar a `system`.
    merged[key] = key !== 'audioSource' && isDict(existing) && isDict(value) ? { ...existing, ...value } : value
  }
  const { settings, warnings } = parseSettings(merged)
  return warnings.length > 0 ? { ok: false, errors: warnings } : { ok: true, settings }
}
