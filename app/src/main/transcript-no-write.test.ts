// Guardas de la regla nº 1 (todo en RAM, ADR 0011): con el guardado apagado no se escribe nada, y
// solo una lista cerrada de módulos puede usar funciones de escritura de `node:fs`.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import type { AppState, OverlayText } from '../shared/ipc.ts'
import { applyPatch, defaultSettings } from '../shared/settings.ts'
import type { Settings } from '../shared/settings.ts'
import { bindTranscript } from './transcript-session.ts'
import { TranscriptWriter } from './transcript-writer.ts'

/** Recorre una sesión completa (iniciar, líneas, pausar, reanudar, detener) con el guardado como diga `enabled`. */
async function session(enabled: boolean): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'tr-nowrite-'))
  const result = applyPatch(defaultSettings(), { transcript: { dir, enabled } })
  assert.ok(result.ok)
  const settings: Settings = result.settings
  const writer = new TranscriptWriter({ settings: { get: () => structuredClone(settings), onChange: () => () => undefined } })
  const controller = Object.assign(new EventEmitter<{ state: [AppState]; text: [OverlayText] }>(), {
    state: { running: false, paused: false, mode: null, phase: 'idle' } as AppState,
  })
  const unbind = bindTranscript(controller, writer)
  const running: AppState = { running: true, paused: false, mode: 'audio', phase: 'running' }
  controller.emit('state', running)
  controller.emit('text', { original: 'secret words', lang: 'en', translations: [{ lang: 'es', text: 'palabras secretas' }], final: true })
  controller.emit('state', { ...running, paused: true, phase: 'paused' })
  controller.emit('state', running)
  controller.emit('text', { original: 'more', lang: 'en', translations: [], final: true })
  controller.emit('state', { running: false, paused: false, mode: null, phase: 'idle' })
  unbind()
  await writer.dispose()
  return readdirSync(dir)
}

test('con el guardado apagado una sesión completa no crea ningún archivo', async () => {
  assert.deepEqual(await session(false), [])
})

test('con el guardado encendido crea exactamente el .txt y el .srt de la sesión', async () => {
  const files = await session(true)
  assert.equal(files.length, 2)
  assert.ok(files.some((f) => f.endsWith('.txt')) && files.some((f) => f.endsWith('.srt')))
})

/** Funciones de `node:fs` que escriben, crean, mueven o borran. */
const WRITERS = new Set([
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'mkdir',
  'mkdirSync',
  'open',
  'openSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
])

/**
 * Los únicos módulos de producto que pueden escribir a disco: preferencias (`settings-store`), exportarlas
 * (`settings-ipc`) y la transcripción (`transcript-writer`). Las pruebas de humo usan carpetas temporales.
 */
const ALLOWED = new Set(['main/settings-store.ts', 'main/settings-ipc.ts', 'main/transcript-writer.ts'])

const SRC = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

/** Nombres de escritura importados de `node:fs` o `node:fs/promises` (o un import de módulo entero). */
export function writersImported(code: string): string[] {
  const found: string[] = []
  for (const match of code.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"](node:)?fs(\/promises)?['"]/g)) {
    if (match[1]) continue // solo tipos
    const clause = match[2] ?? ''
    if (/\*\s+as|^\s*\w+\s*(,|$)/.test(clause)) found.push('<módulo entero>')
    for (const name of clause.replace(/[{}]/g, '').split(',')) {
      const imported = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim()
      if (imported && WRITERS.has(imported) && !/^type\s/.test(name.trim())) found.push(imported)
    }
  }
  return found
}

test('detecta importaciones de escritura (prueba del propio detector)', () => {
  assert.deepEqual(writersImported("import { readFileSync, writeFileSync } from 'node:fs'"), ['writeFileSync'])
  assert.deepEqual(writersImported("import { open as o } from 'node:fs/promises'"), ['open'])
  assert.deepEqual(writersImported("import * as fs from 'fs'"), ['<módulo entero>'])
  assert.deepEqual(writersImported("import type { WriteStream } from 'node:fs'"), [])
  assert.deepEqual(writersImported("import { existsSync } from 'node:fs'"), [])
})

test('solo los módulos permitidos importan funciones que escriben a disco', () => {
  const offenders: string[] = []
  for (const file of sources(SRC)) {
    const name = relative(SRC, file).replaceAll('\\', '/')
    if (/^main\/smoke(-[\w-]+)?\.ts$/.test(name) || ALLOWED.has(name)) continue
    const used = writersImported(readFileSync(file, 'utf8'))
    if (used.length > 0) offenders.push(`${name}: ${used.join(', ')}`)
  }
  assert.deepEqual(offenders, [])
})
