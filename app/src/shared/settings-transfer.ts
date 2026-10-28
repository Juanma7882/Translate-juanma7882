// Exportar e importar preferencias. El archivo solo lleva preferencias: nunca la región elegida,
// ni rutas de carpetas, ni contenido capturado o traducido. Una importación es "todo o nada".

import { defaultSettings, parseSettings, SETTINGS_VERSION } from './settings.ts'
import type { Settings } from './settings.ts'

export const EXPORT_FORMAT = 'translate-settings'

/** Tamaño máximo aceptado al importar (un archivo de preferencias real ocupa menos de 2 KB). */
export const MAX_IMPORT_BYTES = 64 * 1024

/** Campos que no viajan en un archivo de preferencias (dependen del equipo o de la sesión). */
const LOCAL_ONLY = ['lastRegion', 'modelsDir'] as const

export interface ExportedSettings {
  format: typeof EXPORT_FORMAT
  version: typeof SETTINGS_VERSION
  settings: Omit<Settings, 'lastRegion' | 'modelsDir' | 'version'>
}

export function exportSettings(settings: Settings): ExportedSettings {
  const { lastRegion: _region, modelsDir: _dir, version: _version, ...preferences } = structuredClone(settings)
  return { format: EXPORT_FORMAT, version: SETTINGS_VERSION, settings: preferences }
}

export type ImportResult = { ok: true; settings: Settings } | { ok: false; errors: string[] }

const isDict = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Valida el texto de un archivo de preferencias y lo aplica sobre `current`. Los campos que faltan
 * conservan su valor por defecto; `lastRegion` y `modelsDir` siempre se conservan de `current`.
 * Cualquier valor inválido o campo desconocido rechaza la importación entera.
 */
export function importSettings(text: string, current: Settings): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, errors: ['import too large'] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['import is not valid JSON'] }
  }
  if (!isDict(raw) || raw['format'] !== EXPORT_FORMAT) return { ok: false, errors: ['import has an unknown format'] }
  if (raw['version'] !== SETTINGS_VERSION) return { ok: false, errors: ['import has an unknown version'] }
  const incoming = raw['settings']
  if (!isDict(incoming)) return { ok: false, errors: ['import has no settings'] }

  const defaults = defaultSettings() as unknown as Record<string, unknown>
  // Los archivos exportados antes de las pistas múltiples traen `to` (un solo destino): se leen como `targets`.
  if ('to' in incoming && !('targets' in incoming)) {
    const { to, ...rest } = incoming
    return importSettings(JSON.stringify({ ...raw, settings: { ...rest, targets: typeof to === 'string' ? [to] : to } }), current)
  }
  const errors: string[] = []
  for (const key of Object.keys(incoming)) {
    if (!(key in defaults) || key === 'version') errors.push(`unknown setting ${key}`)
    else if ((LOCAL_ONLY as readonly string[]).includes(key)) errors.push(`${key} is not imported`)
  }
  if (errors.length > 0) return { ok: false, errors }

  // Cada sección admite campos parciales; lo que falta toma su valor por defecto.
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(incoming)) {
    const base = defaults[key]
    merged[key] = key !== 'audioSource' && isDict(base) && isDict(value) ? { ...base, ...value } : value
  }
  merged['version'] = SETTINGS_VERSION
  merged['lastRegion'] = current.lastRegion
  merged['modelsDir'] = current.modelsDir

  const { settings, warnings } = parseSettings(merged)
  return warnings.length > 0 ? { ok: false, errors: warnings } : { ok: true, settings }
}
