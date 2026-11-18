// Formato de los archivos de transcripción (`.txt` y `.srt`), con funciones puras y sin E/S.
// Ver la spec `transcript-saving` y el ADR 0011.

/** Una línea final de la sesión: hora relativa al inicio, original con su idioma y traducciones. */
export interface TranscriptEntry {
  /** Milisegundos desde el inicio de la sesión. */
  atMs: number
  lang: string
  original: string
  /** En el orden de los destinos; vacía si no hay destinos o fallaron todas las traducciones. */
  translations: readonly { lang: string; text: string }[]
}

/** Duración mínima y máxima de una entrada del `.srt`. */
export const SRT_MIN_MS = 1000
export const SRT_MAX_MS = 7000

/** Una sola línea: los saltos de línea partirían una entrada del `.srt` (una línea vacía la termina). */
export function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** Clave para no repetir una línea idéntica a la anterior. */
export const normalizeForDedupe = oneLine

const pad = (value: number, size = 2): string => String(value).padStart(size, '0')

/** `HH:MM:SS` para el `.txt`. */
export function clockTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/** `HH:MM:SS,mmm` para el `.srt`. */
export function srtTime(ms: number): string {
  const whole = Math.max(0, Math.floor(ms))
  return `${clockTime(whole)},${pad(whole % 1000, 3)}`
}

/** Las líneas de una entrada: primero el original y luego cada traducción no vacía. */
function entryLines(entry: TranscriptEntry): { lang: string; text: string }[] {
  const lines = [{ lang: entry.lang, text: oneLine(entry.original) }]
  for (const t of entry.translations) {
    const text = oneLine(t.text)
    if (text) lines.push({ lang: t.lang, text })
  }
  return lines
}

/**
 * Bloque del `.txt`:
 * ```
 * [00:01:23] [en] Good morning
 *            [es] Buenos días
 * ```
 */
export function formatTxtEntry(entry: TranscriptEntry): string {
  const stamp = `[${clockTime(entry.atMs)}] `
  const indent = ' '.repeat(stamp.length)
  return `${entryLines(entry)
    .map((line, i) => `${i === 0 ? stamp : indent}[${line.lang}] ${line.text}`)
    .join('\n')}\n\n`
}

/** Cabecera del `.txt` (sin contenido: solo la fecha de inicio). */
export function txtHeader(startedAt: Date): string {
  return `Transcripción · inicio ${dateStamp(startedAt, ' ', ':')}\n\n`
}

/** Fin de una entrada: el inicio de la siguiente, acotado a [1 s, 7 s] y sin solaparse con ella. */
export function srtEnd(startMs: number, nextStartMs: number | null): number {
  if (nextStartMs === null) return startMs + SRT_MAX_MS
  const end = startMs + Math.min(SRT_MAX_MS, Math.max(SRT_MIN_MS, nextStartMs - startMs))
  return Math.min(end, nextStartMs)
}

/** Entrada numerada del `.srt` (el número empieza en 1). */
export function formatSrtEntry(index: number, entry: TranscriptEntry, endMs: number): string {
  const text = entryLines(entry)
    .map((line) => line.text)
    .join('\n')
  return `${index}\n${srtTime(entry.atMs)} --> ${srtTime(endMs)}\n${text}\n\n`
}

function dateStamp(date: Date, between: string, timeSeparator: string): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => pad(n)).join(timeSeparator)
  return `${day}${between}${time}`
}

/** `transcripcion-2026-11-17_18-30-05` (+ `-2`, `-3`… si ya existe) sin extensión; hora local. */
export function sessionFileName(startedAt: Date, attempt = 1): string {
  const base = `transcripcion-${dateStamp(startedAt, '_', '-')}`
  return attempt > 1 ? `${base}-${attempt}` : base
}
