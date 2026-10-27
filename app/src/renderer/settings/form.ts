// Lógica de la ventana de Ajustes, pura y sin DOM: qué idiomas ofrecer, cómo validar un cambio y
// cómo resumir el estado y el progreso de los modelos. La interfaz (Preact) solo la presenta.

import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { ModelProgress } from '../../shared/ipc.ts'
import { applyPatch } from '../../shared/settings.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'

// ------------------------------------------------------------------------------------ idiomas

/** Idiomas de origen que se pueden elegir: con OCR y con al menos un par de traducción. */
export function sourceLanguages(catalog: ModelCatalog): string[] {
  const withPairs = new Set(catalog.pairs.map((p) => p.from))
  return catalog.ocrLanguages.filter((lang) => withPairs.has(lang)).sort()
}

/** Idiomas de destino disponibles para `from`. */
export function targetLanguages(catalog: ModelCatalog, from: string): string[] {
  return catalog.pairs.filter((p) => p.from === from).map((p) => p.to).sort()
}

/**
 * Devuelve un par válido lo más parecido posible al pedido: si `from` no tiene pares se usa el
 * primer origen disponible; si `to` no es válido para `from` se usa su primer destino.
 * `null` si el catálogo no tiene ningún par.
 */
export function pickPair(catalog: ModelCatalog, from: string, to: string): { from: string; to: string } | null {
  const sources = sourceLanguages(catalog)
  const source = sources.includes(from) ? from : sources[0]
  if (!source) return null
  const targets = targetLanguages(catalog, source)
  const target = targets.includes(to) ? to : targets[0]
  return target ? { from: source, to: target } : null
}

/** Mensaje de error para un par de idiomas, o `null` si es válido. */
export function languageError(catalog: ModelCatalog, from: string, to: string): string | null {
  if (from === to) return 'Elige idiomas de origen y destino distintos.'
  const supported = catalog.pairs.some((p) => p.from === from && p.to === to)
  return supported ? null : 'No hay modelos para traducir entre esos dos idiomas.'
}

/** Nombre del idioma en español (`en` -> "inglés"); si el motor de Intl no lo conoce, el propio código. */
export function languageName(code: string, locale = 'es'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

// ---------------------------------------------------------------------------------- validación

const FIELD_MESSAGES: Record<string, string> = {
  'invalid from': 'El idioma de origen no es válido.',
  'invalid to': 'El idioma de destino no es válido.',
  'from and to must differ': 'Elige idiomas de origen y destino distintos.',
  'invalid engines': 'Elige un conjunto de motores válido.',
  'invalid modelsDir': 'La carpeta de modelos no es válida.',
  'invalid overlay.opacity': 'La opacidad debe estar entre 0,1 y 1.',
  'invalid overlay.fontSize': 'El tamaño de fuente debe estar entre 10 y 96 píxeles.',
  'invalid overlay.fontFamily': 'La fuente contiene caracteres no permitidos.',
  'invalid overlay.width': 'El ancho debe ser un número entero entre 200 y 3000 píxeles.',
  'invalid overlay.placement': 'La posición debe ser automática o manual.',
  'invalid overlay.x': 'La coordenada X no es válida.',
  'invalid overlay.y': 'La coordenada Y no es válida.',
  'invalid overlay.hideAfterMs': 'El tiempo para ocultar debe estar entre 0 y 600 segundos.',
  'invalid overlay.showOriginal': 'La opción de mostrar el original no es válida.',
  'invalid shortcuts.selectRegion': 'El atajo para elegir región no es válido (por ejemplo, CommandOrControl+Shift+T).',
  'invalid shortcuts.togglePause': 'El atajo para pausar no es válido (por ejemplo, CommandOrControl+Shift+P).',
}

export function describeError(code: string): string {
  return FIELD_MESSAGES[code] ?? 'Hay un valor no válido.'
}

export type PatchCheck = { ok: true; settings: Settings } | { ok: false; errors: string[] }

/** Comprueba un cambio antes de enviarlo: mismas reglas que el proceso principal, con mensajes en español. */
export function checkPatch(current: Settings, patch: SettingsPatch, catalog: ModelCatalog | null): PatchCheck {
  const result = applyPatch(current, patch)
  if (!result.ok) return { ok: false, errors: [...new Set(result.errors.map(describeError))] }
  if (catalog) {
    const problem = languageError(catalog, result.settings.from, result.settings.to)
    if (problem) return { ok: false, errors: [problem] }
  }
  return result
}

// ------------------------------------------------------------------------------------- modelos

/** `31,1 MB`, `115,3 MB`, `74,9 KB`. */
export function formatBytes(bytes: number): string {
  const format = (value: number) => new Intl.NumberFormat('es', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(value)
  if (bytes >= 1e9) return `${format(bytes / 1e9)} GB`
  if (bytes >= 1e6) return `${format(bytes / 1e6)} MB`
  if (bytes >= 1e3) return `${format(bytes / 1e3)} KB`
  return `${bytes} B`
}

export interface ModelsSummary {
  missing: ModelStatusInfo[]
  allReady: boolean
  anyDownloading: boolean
  /** Bytes que faltan por descargar. */
  missingBytes: number
}

export function summarize(statuses: readonly ModelStatusInfo[]): ModelsSummary {
  const missing = statuses.filter((s) => s.state !== 'ready')
  return {
    missing,
    allReady: statuses.length > 0 && missing.length === 0,
    anyDownloading: statuses.some((s) => s.state === 'downloading'),
    missingBytes: missing.reduce((sum, s) => sum + s.size, 0),
  }
}

export type DownloadProgress = Readonly<Record<string, { downloaded: number; total: number }>>

export function applyProgress(progress: DownloadProgress, event: ModelProgress): DownloadProgress {
  const previous = progress[event.model]
  const total = event.total ?? previous?.total ?? 0
  return { ...progress, [event.model]: { downloaded: Math.max(previous?.downloaded ?? 0, event.downloaded), total } }
}

/** Avance global (0 a 100) de la descarga de los modelos que faltan; nunca retrocede y no pasa de 100. */
export function overallPercent(progress: DownloadProgress, missing: readonly ModelStatusInfo[]): number {
  const total = missing.reduce((sum, m) => sum + m.size, 0)
  if (total === 0) return 100
  const done = missing.reduce((sum, m) => sum + Math.min(m.size, progress[m.id]?.downloaded ?? 0), 0)
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)))
}

// ------------------------------------------------------------------------------- fuentes

/** Fuentes que se ofrecen (todas pasan la validación de `fontFamily`). */
export const FONT_CHOICES: readonly { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Sistema', value: 'system-ui, sans-serif' },
  { label: 'Segoe UI', value: "'Segoe UI', sans-serif" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Monoespaciada', value: "'Courier New', monospace" },
]
