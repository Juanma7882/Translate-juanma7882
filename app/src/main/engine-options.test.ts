import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultSettings } from '../shared/settings.ts'
import { engineOptionsFrom, FRAME_INTERVAL_MS } from './engine-options.ts'

test('el modo automático activa el fallback con la espera configurada', () => {
  const settings = { ...defaultSettings(), mode: 'auto' as const, fallbackSeconds: 7 }
  const options = engineOptionsFrom(settings)
  assert.equal(options.autoFallback, true)
  assert.equal(options.fallbackNoTextMs, 7000)
  assert.equal(options.frameIntervalMs, FRAME_INTERVAL_MS)
})

test('solo texto y solo audio no activan el fallback', () => {
  for (const mode of ['text', 'audio'] as const) {
    const options = engineOptionsFrom({ ...defaultSettings(), mode })
    assert.equal(options.autoFallback, undefined, mode)
    assert.equal(options.fallbackNoTextMs, undefined, mode)
  }
})

test('la carpeta de modelos solo se pasa si está definida', () => {
  assert.equal(engineOptionsFrom(defaultSettings()).modelsDir, undefined)
  assert.equal(engineOptionsFrom({ ...defaultSettings(), modelsDir: '/m' }).modelsDir, '/m')
})
