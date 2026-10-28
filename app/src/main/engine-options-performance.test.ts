import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultSettings } from '../shared/settings.ts'
import { engineOptionsFrom } from './engine-options.ts'

test('con el rendimiento en automático no se envía nada', () => {
  assert.equal(engineOptionsFrom(defaultSettings()).performance, undefined)
})

test('solo se envían los parámetros de rendimiento fijados por el usuario', () => {
  const only = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 4, beamWidth: 0, cacheCapacity: 0, ocrMaxSide: 0, lowMemory: false } })
  assert.deepEqual(only.performance, { intraThreads: 4 })
  const all = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 2, beamWidth: 3, cacheCapacity: 1024, ocrMaxSide: 640, lowMemory: true } })
  assert.deepEqual(all.performance, { intraThreads: 2, beamWidth: 3, cacheCapacity: 1024, ocrMaxSide: 640, lowMemory: true })
})

test('poca memoria desactivada y lado 0 no se envían', () => {
  const off = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 0, beamWidth: 0, cacheCapacity: 0, ocrMaxSide: 0, lowMemory: false } })
  assert.equal(off.performance, undefined)
  const on = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 0, beamWidth: 0, cacheCapacity: 0, ocrMaxSide: 0, lowMemory: true } })
  assert.deepEqual(on.performance, { lowMemory: true })
})
