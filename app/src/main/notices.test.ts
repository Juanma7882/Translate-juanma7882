import assert from 'node:assert/strict'
import { test } from 'node:test'

import { noticeForTranscriptFailure } from './notices.ts'

test('el aviso de fallo de la transcripción es un error que dice que la traducción sigue', () => {
  const notice = noticeForTranscriptFailure()
  assert.equal(notice.level, 'error')
  assert.match(notice.message, /transcripción/)
  assert.match(notice.message, /la traducción sigue/)
  assert.doesNotMatch(notice.message, /[\\/]/, 'sin rutas')
})
