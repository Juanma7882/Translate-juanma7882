// Lógica de la ventana de Ajustes, pura y sin DOM: qué idiomas ofrecer, cómo validar un cambio y
// cómo resumir el estado y el progreso de los modelos. La interfaz (Preact) solo la presenta.

import type { InstalledModelInfo, ModelCatalog, ModelInventory, ModelStatusInfo } from 'tr-bindings'

import { contrastRatio, MIN_CONTRAST } from '../../shared/contrast.ts'
import type { DeleteFailure, ModelProgress } from '../../shared/ipc.ts'
import type { Mode } from '../../shared/mode.ts'
import { applyPatch, MAX_SUBTITLES } from '../../shared/settings.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'

// ------------------------------------------------------------------------------------ idiomas

/**
 * Idiomas de origen que se pueden elegir: los que el modo actual sabe leer (texto: OCR; audio: voz;
 * automático: ambos). No hace falta ningún par de traducción: con solo el subtítulo original no se traduce.
 */
export function sourceLanguages(catalog: ModelCatalog, mode: Mode = 'text'): string[] {
  const ocr = new Set(catalog.ocrLanguages)
  const stt = new Set(catalog.sttLanguages)
  const pool = mode === 'text' ? ocr : mode === 'audio' ? stt : new Set([...ocr].filter((lang) => stt.has(lang)))
  return [...pool].sort()
}

/** Idiomas de destino disponibles para `from`. */
export function targetLanguages(catalog: ModelCatalog, from: string): string[] {
  return catalog.pairs.filter((p) => p.from === from).map((p) => p.to).sort()
}

/** Mensaje de error para un origen y sus destinos, o `null` si son válidos. */
export function languageError(catalog: ModelCatalog, from: string, targets: readonly string[]): string | null {
  if (targets.includes(from)) return 'Elige idiomas de origen y destino distintos.'
  const missing = targets.some((to) => !catalog.pairs.some((p) => p.from === from && p.to === to))
  return missing ? 'No hay modelos para traducir entre esos dos idiomas.' : null
}

/** Los subtítulos tal como los presenta la interfaz: «Subtítulo 1» siempre y «Subtítulo 2» si está activo. */
export interface SubtitleChoice {
  /** Idioma del subtítulo 1 (el de origen significa el texto original). */
  first: string
  /** Idioma del subtítulo 2, o `null` si no está activo. */
  second: string | null
}

/** La elección de la interfaz a partir de los ajustes: primero el original (si se muestra) y luego los destinos. */
export function subtitlesOf(settings: Pick<Settings, 'from' | 'targets'> & { overlay: Pick<Settings['overlay'], 'showOriginal'> }): SubtitleChoice {
  const langs = [...(settings.overlay.showOriginal ? [settings.from] : []), ...settings.targets]
  return { first: langs[0] ?? settings.from, second: langs[1] ?? null }
}

/** Los ajustes que representan la elección: el idioma de origen es el subtítulo original; el resto, destinos. */
export function patchForSubtitles(from: string, choice: SubtitleChoice): SettingsPatch {
  const langs = [choice.first, ...(choice.second === null ? [] : [choice.second])]
  return { from, targets: langs.filter((lang) => lang !== from), overlay: { showOriginal: langs.includes(from) } }
}

/** `inglés → español + francés`, o `inglés (sin traducir)` si solo se muestra el original. */
export function languagesSummary(settings: Pick<Settings, 'from' | 'targets'>): string {
  if (settings.targets.length === 0) return `${languageName(settings.from)} (sin traducir)`
  return `${languageName(settings.from)} → ${settings.targets.map((lang) => languageName(lang)).join(' + ')}`
}

/** Idiomas que puede elegir un subtítulo: el original y los destinos desde `from`, menos el del otro subtítulo. */
export function subtitleOptions(catalog: ModelCatalog, from: string, other: string | null): string[] {
  return [from, ...targetLanguages(catalog, from)].filter((lang) => lang !== other)
}

export interface SourceChange {
  patch: SettingsPatch
  /** Destinos que se quitaron por no existir desde el nuevo origen. */
  removed: string[]
}

/**
 * Cambia el idioma de origen. Los destinos que no existen desde el nuevo origen (o que serían el propio
 * origen) se quitan y se devuelven para avisar; si no queda ningún subtítulo se mantiene el original.
 */
export function changeSource(catalog: ModelCatalog, current: Settings, from: string): SourceChange {
  const available = new Set(targetLanguages(catalog, from))
  const kept = current.targets.filter((lang) => available.has(lang))
  const removed = current.targets.filter((lang) => !available.has(lang))
  const showOriginal = current.overlay.showOriginal || kept.length === 0
  // Con el original y dos destinos serían tres subtítulos: no se da en la práctica (ya era válido antes), pero se acota.
  const targets = kept.slice(0, MAX_SUBTITLES - (showOriginal ? 1 : 0))
  return { patch: { from, targets, overlay: { showOriginal } }, removed }
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
  'invalid targets': 'Los idiomas de destino no son válidos: como máximo dos, distintos entre sí y del idioma de origen.',
  'invalid subtitles': 'Elige uno o dos subtítulos (el original cuenta como uno): al menos uno y como máximo dos.',
  'from and to must differ': 'Elige idiomas de origen y destino distintos.',
  'invalid engines': 'Elige un conjunto de motores válido.',
  'invalid mode': 'Elige un modo válido: automático, solo texto o solo audio.',
  'invalid fallbackSeconds': 'La espera para pasar a audio debe ser un número entero de segundos entre 1 y 60.',
  'invalid voiceThreshold': 'El umbral de voz debe estar entre 0,1 % y 50 %.',
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
  'invalid overlay.textColor': 'El color del texto no es válido.',
  'invalid overlay.backgroundColor': 'El color de fondo no es válido.',
  'invalid overlay.contrast': 'El texto y el fondo necesitan un contraste de al menos 4,5 a 1 para leerse bien.',
  'invalid overlay.maxLines': 'El máximo de líneas debe ser un entero entre 1 y 6.',
  'invalid performance': 'Los parámetros de rendimiento no son válidos.',
  'invalid performance.intraThreads': 'Los hilos deben ser 0 (automático) o un entero entre 1 y 64.',
  'invalid performance.beamWidth': 'La anchura del haz debe ser 0 (por defecto) o un entero entre 1 y 8.',
  'invalid performance.cacheCapacity': 'La caché debe ser 0 (por defecto) o un entero entre 16 y 1 000 000.',
  'invalid performance.ocrMaxSide': 'El lado de detección del OCR debe ser 0 (por defecto) o un entero entre 160 y 4000.',
  'invalid performance.lowMemory': 'La opción de poca memoria no es válida.',
  'import too large': 'El archivo es demasiado grande para ser un archivo de preferencias.',
  'import is not valid JSON': 'El archivo no es un JSON válido.',
  'import has an unknown format': 'El archivo no es de preferencias de este programa.',
  'import has an unknown version': 'El archivo es de una versión que no se puede importar.',
  'import has no settings': 'El archivo no contiene preferencias.',
  'import could not be read': 'No se pudo leer el archivo.',
  'export failed': 'No se pudo guardar el archivo.',
  'invalid shortcuts.selectRegion': 'El atajo para elegir región no es válido (por ejemplo, CommandOrControl+Shift+T).',
  'invalid shortcuts.togglePause': 'El atajo para pausar no es válido (por ejemplo, CommandOrControl+Shift+P).',
  'invalid shortcuts.toggleMode': 'El atajo para cambiar de modo no es válido (por ejemplo, CommandOrControl+Shift+M).',
}

export function describeError(code: string): string {
  const direct = FIELD_MESSAGES[code]
  if (direct) return direct
  if (code.startsWith('invalid modelsDir: ')) return dirMessage(code.slice('invalid modelsDir: '.length))
  if (code.startsWith('unknown setting ')) return 'El archivo contiene un ajuste desconocido.'
  if (code.endsWith(' is not imported')) return 'El archivo contiene datos del equipo (región o carpeta) que no se importan.'
  return 'Hay un valor no válido.'
}

/** Motivo por el que una carpeta de modelos no sirve, en español. */
export function dirMessage(reason: string): string {
  switch (reason) {
    case 'not-absolute':
      return 'Escribe una ruta completa (empieza en la raíz de una unidad o en /).'
    case 'parent-references':
      return 'La ruta no puede contener «..» ni «.».'
    case 'root':
      return 'No uses la raíz del disco: elige o crea una carpeta.'
    case 'not-a-folder':
      return 'Esa ruta es un archivo, no una carpeta.'
    case 'not-writable':
      return 'No se puede escribir en esa carpeta. Elige otra.'
    case 'running':
      return 'No se puede cambiar la carpeta mientras hay una traducción en marcha.'
    case 'empty':
      return 'Escribe una carpeta o usa «Predeterminada».'
    default:
      return 'La carpeta de modelos no es válida.'
  }
}

export type PatchCheck = { ok: true; settings: Settings } | { ok: false; errors: string[] }

/** Comprueba un cambio antes de enviarlo: mismas reglas que el proceso principal, con mensajes en español. */
export function checkPatch(current: Settings, patch: SettingsPatch, catalog: ModelCatalog | null): PatchCheck {
  const result = applyPatch(current, patch)
  if (!result.ok) return { ok: false, errors: [...new Set(result.errors.map(describeError))] }
  if (catalog) {
    const problem = languageError(catalog, result.settings.from, result.settings.targets)
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

// ------------------------------------------------------------------- errores junto al campo

const FIELD_IDS: Record<string, string> = {
  'invalid fallbackSeconds': 'fallbackSeconds',
  'invalid voiceThreshold': 'voiceThreshold',
  'invalid overlay.opacity': 'opacity',
  'invalid overlay.fontSize': 'fontSize',
  'invalid overlay.fontFamily': 'fontFamily',
  'invalid overlay.width': 'width',
  'invalid overlay.hideAfterMs': 'hideAfter',
  'invalid overlay.x': 'overlay-x',
  'invalid overlay.y': 'overlay-y',
  'invalid overlay.textColor': 'textColor',
  'invalid overlay.backgroundColor': 'backgroundColor',
  'invalid overlay.contrast': 'textColor',
  'invalid overlay.maxLines': 'maxLines',
  'invalid performance.intraThreads': 'perf-threads',
  'invalid performance.beamWidth': 'perf-beam',
  'invalid performance.cacheCapacity': 'perf-cache',
  'invalid performance.ocrMaxSide': 'perf-ocr-side',
  'invalid performance.lowMemory': 'perf-lowmem',
  'invalid shortcuts.selectRegion': 'shortcut-select',
  'invalid shortcuts.togglePause': 'shortcut-pause',
  'invalid shortcuts.toggleMode': 'shortcut-mode',
}

/** Identificador del control al que pertenece un error (para mostrarlo junto a él), o `null` si es general. */
export function fieldOf(code: string): string | null {
  if (code.startsWith('invalid modelsDir')) return 'models-dir'
  return FIELD_IDS[code] ?? null
}

export interface Issue {
  /** Control afectado (`null` = error general). */
  field: string | null
  message: string
}

/** Convierte los códigos de error del proceso principal en avisos en español, sin repetidos. */
export function toIssues(codes: readonly string[]): Issue[] {
  const seen = new Set<string>()
  const issues: Issue[] = []
  for (const code of codes) {
    const message = describeError(code)
    if (seen.has(message)) continue
    seen.add(message)
    issues.push({ field: fieldOf(code), message })
  }
  return issues
}

// ---------------------------------------------------------------------- contraste

/** `7,3 a 1` con coma decimal. */
export function formatRatio(ratio: number): string {
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(ratio)} a 1`
}

export interface ContrastInfo {
  ok: boolean
  ratio: number
  text: string
}

export function contrastInfo(textColor: string, backgroundColor: string): ContrastInfo {
  const ratio = contrastRatio(textColor, backgroundColor)
  const ok = ratio >= MIN_CONTRAST
  return {
    ok,
    ratio,
    text: ok ? `Contraste ${formatRatio(ratio)}: legible.` : `Contraste ${formatRatio(ratio)}: demasiado bajo (mínimo ${formatRatio(MIN_CONTRAST)}).`,
  }
}

// ---------------------------------------------------------------------- modelos instalados

const KIND_TITLES: Record<string, string> = {
  ocr: 'Reconocimiento de texto',
  stt: 'Reconocimiento de voz',
  translate: 'Traducción',
}

/** Nombre legible de un modelo: `Traducción inglés → español`, `Reconocimiento de texto (8 idiomas)`. */
export function modelTitle(model: Pick<InstalledModelInfo, 'id' | 'roles'>): string {
  const first = model.roles[0]
  if (!first) return model.id
  const title = KIND_TITLES[first.kind] ?? model.id
  if (first.kind === 'translate') {
    const [from, to] = first.key.split('-')
    return from && to ? `${title} ${languageName(from)} → ${languageName(to)}` : title
  }
  const count = model.roles.length
  return count === 1 ? `${title} (${languageName(first.key)})` : `${title} (${count} idiomas)`
}

export interface InstalledRow {
  id: string
  title: string
  /** Bytes en disco (archivos completos más parciales). */
  bytes: number
  partialBytes: number
  state: ModelStatusInfo['state']
}

/** Modelos que ocupan espacio (completos o a medias), del mayor al menor. */
export function installedRows(inventory: ModelInventory): InstalledRow[] {
  return inventory.models
    .filter((m) => m.diskBytes > 0 || m.partialBytes > 0)
    .map((m) => ({ id: m.id, title: modelTitle(m), bytes: m.diskBytes + m.partialBytes, partialBytes: m.partialBytes, state: m.state }))
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id))
}

/** Bytes de descargas a medias de los modelos con identificador en `ids`. */
export function partialBytesOf(inventory: ModelInventory | null, ids: readonly string[]): number {
  if (!inventory) return 0
  return inventory.models.filter((m) => ids.includes(m.id)).reduce((sum, m) => sum + m.partialBytes, 0)
}

export function deleteMessage(reason: DeleteFailure): string {
  switch (reason) {
    case 'running':
      return 'No se puede borrar mientras hay una traducción en marcha: detén la traducción primero.'
    case 'downloading':
      return 'Ese modelo se está descargando. Cancela la descarga antes de borrarlo.'
    case 'unknown':
      return 'Ese modelo no existe en el catálogo.'
    case 'failed':
      return 'No se pudo borrar el modelo. Comprueba los permisos de la carpeta.'
  }
}

/** Cómo se describe el estado de un modelo para el usuario. */
export function stateLabel(state: ModelStatusInfo['state']): string {
  return state === 'ready' ? 'listo' : state === 'downloading' ? 'descargando' : 'falta'
}

// ------------------------------------------------------------------------ pestañas

export interface TabSpec {
  id: string
  label: string
}

/**
 * Pestaña a la que lleva una tecla (patrón de pestañas de WAI-ARIA): flechas con vuelta,
 * Inicio y Fin. `null` si la tecla no navega.
 */
export function tabForKey(tabs: readonly TabSpec[], current: string, key: string): string | null {
  const index = tabs.findIndex((t) => t.id === current)
  if (index < 0 || tabs.length === 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return tabs[(index + 1) % tabs.length]!.id
    case 'ArrowLeft':
    case 'ArrowUp':
      return tabs[(index - 1 + tabs.length) % tabs.length]!.id
    case 'Home':
      return tabs[0]!.id
    case 'End':
      return tabs[tabs.length - 1]!.id
    default:
      return null
  }
}
