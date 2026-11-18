import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeError, fieldOf, toIssues, transcriptDirMessage } from './form.ts'

test('los errores de la carpeta de la transcripción se muestran junto a su botón', () => {
  assert.equal(fieldOf('invalid transcript.dir: missing'), 'transcript-dir')
  assert.equal(fieldOf('invalid transcript.dir'), 'transcript-dir')
  assert.equal(describeError('invalid transcript.dir: not-writable'), transcriptDirMessage('not-writable'))
  assert.match(transcriptDirMessage('missing'), /no existe/)
})

test('activar sin carpeta pide elegirla, junto a la casilla', () => {
  assert.deepEqual(toIssues(['invalid transcript.enabled']), [{ field: 'transcript-enabled', message: 'Elige primero una carpeta donde guardar la transcripción.' }])
})

test('importar un archivo con la transcripción explica que no se importa', () => {
  assert.match(describeError('transcript is not imported'), /transcripción/)
})
