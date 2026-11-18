import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkTranscriptDir } from './transcript-dir.ts'

test('una carpeta temporal existente y escribible es válida', async () => {
  assert.deepEqual(await checkTranscriptDir(mkdtempSync(join(tmpdir(), 'tr-tdir-'))), { ok: true })
})

test('una ruta relativa se rechaza', async () => {
  assert.deepEqual(await checkTranscriptDir('transcripciones'), { ok: false, reason: 'not-absolute' })
})

test('una carpeta inexistente se rechaza', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'tr-tdir-')), 'no-existe')
  assert.deepEqual(await checkTranscriptDir(missing), { ok: false, reason: 'missing' })
})

test('un archivo no es una carpeta', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tr-tdir-')), 'a.txt')
  writeFileSync(file, '')
  assert.deepEqual(await checkTranscriptDir(file), { ok: false, reason: 'not-a-folder' })
})
