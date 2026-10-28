import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyPatch, defaultSettings, parseSettings } from './settings.ts'

describe('colores, líneas y rendimiento (hito 5)', () => {
  const base = defaultSettings()

  test('los valores por defecto del overlay son legibles', () => {
    assert.equal(base.overlay.textColor, '#ffffff')
    assert.equal(base.overlay.backgroundColor, '#0c0c10')
    assert.equal(base.overlay.maxLines, 2)
    assert.deepEqual(base.performance, { intraThreads: 0, beamWidth: 0, cacheCapacity: 0 })
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
    const ok = applyPatch(base, { performance: { intraThreads: 4, beamWidth: 3, cacheCapacity: 512 } })
    assert.ok(ok.ok)
    if (ok.ok) assert.deepEqual(ok.settings.performance, { intraThreads: 4, beamWidth: 3, cacheCapacity: 512 })
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
    ]
    for (const [performance, error] of cases) assert.deepEqual(applyPatch(base, { performance }), { ok: false, errors: [error] })
  })
})
