import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initialActive, MODES, needsRegion, nextMode, scopeForMode } from './mode.ts'

test('alternar recorre automático, texto y audio y vuelve al principio', () => {
  assert.deepEqual(MODES, ['auto', 'text', 'audio'])
  assert.equal(nextMode('auto'), 'text')
  assert.equal(nextMode('text'), 'audio')
  assert.equal(nextMode('audio'), 'auto')
})

test('cada modo pide los modelos de su ámbito', () => {
  assert.equal(scopeForMode('text'), 'text')
  assert.equal(scopeForMode('audio'), 'audio')
  assert.equal(scopeForMode('auto'), 'all')
})

test('solo el audio puro prescinde de la región y empieza en audio', () => {
  assert.deepEqual(MODES.map(needsRegion), [true, true, false])
  assert.deepEqual(MODES.map(initialActive), ['text', 'text', 'audio'])
})
