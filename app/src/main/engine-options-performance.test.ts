import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultSettings } from '../shared/settings.ts'
import { engineOptionsFrom } from './engine-options.ts'

test('con el rendimiento en automático no se envía nada', () => {
  assert.equal(engineOptionsFrom(defaultSettings()).performance, undefined)
})

test('solo se envían los parámetros de rendimiento fijados por el usuario', () => {
  const only = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 4, beamWidth: 0, cacheCapacity: 0 } })
  assert.deepEqual(only.performance, { intraThreads: 4 })
  const all = engineOptionsFrom({ ...defaultSettings(), performance: { intraThreads: 2, beamWidth: 3, cacheCapacity: 1024 } })
  assert.deepEqual(all.performance, { intraThreads: 2, beamWidth: 3, cacheCapacity: 1024 })
})
