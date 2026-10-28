import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyPatch, defaultSettings, parseSettings } from './settings.ts'

describe('colores, líneas y rendimiento (hito 5)', () => {
  const base = defaultSettings()

  test('los valores por defecto del overlay son legibles', () => {
    assert.equal(base.overlay.textColor, '#ffffff')
    assert.equal(base.overlay.backgroundColor, '#0c0c10')
    assert.equal(base.overlay.maxLines, 2)
    assert.deepEqual(base.performance, { intraThreads: 0, beamWidth: 0, cacheCapacity: 0, ocrMaxSide: 0, lowMemory: false })
  })

  test('un archivo anterior al hito 5 se completa con los valores nuevos sin avisos', () => {
    const { overlay, performance: _performance, ...legacy } = base
    const { textColor: _t, backgroundColor: _b, maxLines: _m, ...legacyOverlay } = overlay
    const { settings, warnings } = parseSettings({ ...legacy, overlay: legacyOverlay })
    assert.deepEqual(warnings, [])
    assert.deepEqual(settings, base)
  })

  test('los colores válidos se aceptan y se normalizan a minúsculas', () => {
    const result = applyPatch(base, { overlay: { textColor: '#FFEE00', backgroundColor: '#000000' } })
    assert.ok(result.ok)
    if (result.ok) assert.equal(result.settings.overlay.textColor, '#ffee00')
  })

  test('un color mal escrito se rechaza nombrando el campo, no el valor', () => {
    for (const color of ['red', '#fff', '#12345', 5, null]) {
      const result = applyPatch(base, { overlay: { textColor: color } })
      assert.deepEqual(result, { ok: false, errors: ['invalid overlay.textColor'] }, String(color))
    }
  })

  test('texto y fondo con poco contraste se rechazan', () => {
    const result = applyPatch(base, { overlay: { textColor: '#cccccc', backgroundColor: '#ffffff' } })
    assert.deepEqual(result, { ok: false, errors: ['invalid overlay.contrast'] })
    // Cambiar solo uno de los dos también se comprueba contra el otro.
    const onlyText = applyPatch(base, { overlay: { textColor: '#101018' } })
    assert.deepEqual(onlyText, { ok: false, errors: ['invalid overlay.contrast'] })
  })

  test('una combinación de contraste justo suficiente se acepta', () => {
    const result = applyPatch(base, { overlay: { textColor: '#767676', backgroundColor: '#ffffff' } })
    assert.equal(result.ok, true)
  })

  test('un archivo guardado con mal contraste vuelve a los colores por defecto y avisa', () => {
    const { settings, warnings } = parseSettings({ ...base, overlay: { ...base.overlay, textColor: '#222222', backgroundColor: '#222222' } })
    assert.deepEqual(warnings, ['invalid overlay.contrast'])
    assert.equal(settings.overlay.textColor, '#ffffff')
    assert.equal(settings.overlay.backgroundColor, '#0c0c10')
  })

  test('el máximo de líneas es un entero de 1 a 6', () => {
    assert.equal(applyPatch(base, { overlay: { maxLines: 6 } }).ok, true)
    assert.equal(applyPatch(base, { overlay: { maxLines: 1 } }).ok, true)
    for (const bad of [0, 7, 2.5, '3']) {
      assert.deepEqual(applyPatch(base, { overlay: { maxLines: bad } }), { ok: false, errors: ['invalid overlay.maxLines'] }, String(bad))
    }
  })

  test('el rendimiento acepta automático (0) y valores en rango', () => {
    const ok = applyPatch(base, { performance: { intraThreads: 4, beamWidth: 3, cacheCapacity: 512, ocrMaxSide: 640, lowMemory: true } })
    assert.ok(ok.ok)
    if (ok.ok) assert.deepEqual(ok.settings.performance, { intraThreads: 4, beamWidth: 3, cacheCapacity: 512, ocrMaxSide: 640, lowMemory: true })
    assert.equal(applyPatch(base, { performance: { cacheCapacity: 0 } }).ok, true)
  })

  test('el rendimiento fuera de rango se rechaza campo por campo', () => {
    const cases: [Record<string, number>, string][] = [
      [{ intraThreads: 65 }, 'invalid performance.intraThreads'],
      [{ intraThreads: -1 }, 'invalid performance.intraThreads'],
      [{ beamWidth: 9 }, 'invalid performance.beamWidth'],
      [{ cacheCapacity: 5 }, 'invalid performance.cacheCapacity'],
      [{ cacheCapacity: 2_000_000 }, 'invalid performance.cacheCapacity'],
      [{ cacheCapacity: 100.5 }, 'invalid performance.cacheCapacity'],
      [{ ocrMaxSide: 159 }, 'invalid performance.ocrMaxSide'],
      [{ ocrMaxSide: 4001 }, 'invalid performance.ocrMaxSide'],
      [{ ocrMaxSide: 640.5 }, 'invalid performance.ocrMaxSide'],
    ]
    for (const [performance, error] of cases) assert.deepEqual(applyPatch(base, { performance }), { ok: false, errors: [error] })
  })
})

describe('voiceThreshold', () => {
  const base = defaultSettings()
  test('0 es automático y 0,001 a 0,5 es válido', () => {
    assert.equal(base.voiceThreshold, 0)
    for (const value of [0, 0.001, 0.02, 0.5]) assert.equal(applyPatch(base, { voiceThreshold: value }).ok, true)
  })
  test('fuera de rango se rechaza', () => {
    for (const value of [-0.1, 0.0005, 0.51, 'x']) assert.deepEqual(applyPatch(base, { voiceThreshold: value }), { ok: false, errors: ['invalid voiceThreshold'] })
  })
})

describe('keepWhileUnchanged', () => {
  const base = defaultSettings()
  test('por defecto está desactivado', () => {
    assert.equal(base.overlay.keepWhileUnchanged, false)
  })
  test('un archivo sin el campo se completa con false y sin avisos', () => {
    const { keepWhileUnchanged: _k, ...legacyOverlay } = base.overlay
    const { settings, warnings } = parseSettings({ ...base, overlay: legacyOverlay })
    assert.deepEqual(warnings, [])
    assert.equal(settings.overlay.keepWhileUnchanged, false)
  })
  test('se puede activar y desactivar', () => {
    const on = applyPatch(base, { overlay: { keepWhileUnchanged: true } })
    assert.ok(on.ok)
    if (on.ok) {
      assert.equal(on.settings.overlay.keepWhileUnchanged, true)
      const off = applyPatch(on.settings, { overlay: { keepWhileUnchanged: false } })
      assert.ok(off.ok)
      if (off.ok) assert.equal(off.settings.overlay.keepWhileUnchanged, false)
    }
  })
  test('un valor que no es booleano se rechaza nombrando el campo', () => {
    for (const value of ['yes', 1, null]) {
      assert.deepEqual(applyPatch(base, { overlay: { keepWhileUnchanged: value } }), { ok: false, errors: ['invalid overlay.keepWhileUnchanged'] }, String(value))
    }
  })
})
