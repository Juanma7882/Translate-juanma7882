import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyPatch, defaultSettings, parseSettings, SETTINGS_VERSION } from './settings.ts'

describe('valores por defecto', () => {
  test('son válidos y no generan avisos al validarse', () => {
    const { settings, warnings } = parseSettings(defaultSettings())
    assert.deepEqual(warnings, [])
    assert.deepEqual(settings, defaultSettings())
  })

  test('cada llamada devuelve un objeto nuevo', () => {
    const a = defaultSettings()
    a.overlay.opacity = 0.2
    assert.equal(defaultSettings().overlay.opacity, 0.85)
  })
})

describe('parseSettings', () => {
  test('lo que no es un objeto o tiene otra versión vuelve a los valores por defecto', () => {
    for (const raw of [null, undefined, 'x', 42, [], true]) {
      const result = parseSettings(raw)
      assert.deepEqual(result.settings, defaultSettings())
      assert.deepEqual(result.warnings, ['settings are not an object'])
    }
    const future = parseSettings({ ...defaultSettings(), version: SETTINGS_VERSION + 1 })
    assert.deepEqual(future.settings, defaultSettings())
    assert.deepEqual(future.warnings, ['unknown settings version'])
  })

  test('un objeto con solo la versión se completa con los valores por defecto sin avisos', () => {
    const { settings, warnings } = parseSettings({ version: SETTINGS_VERSION })
    assert.deepEqual(settings, defaultSettings())
    assert.deepEqual(warnings, [])
  })

  test('los valores válidos se respetan', () => {
    const wanted = {
      ...defaultSettings(),
      from: 'ja',
      to: 'en-US',
      engines: 'fake',
      modelsDir: '/data/models',
      lastRegion: { x: 10, y: 20, width: 300, height: 80, monitor: 1 },
      overlay: { ...defaultSettings().overlay, opacity: 0.5, fontSize: 40, placement: 'manual', x: 5, y: 6, showOriginal: false },
    }
    const { settings, warnings } = parseSettings(wanted)
    assert.deepEqual(warnings, [])
    assert.deepEqual(settings, wanted)
  })

  test('cada campo inválido vuelve a su valor por defecto y el aviso nombra el campo, no el valor', () => {
    const secret = 'SECRET-VALUE-123'
    const { settings, warnings } = parseSettings({
      ...defaultSettings(),
      from: secret,
      engines: secret,
      overlay: { ...defaultSettings().overlay, opacity: 7, fontSize: 'big', fontFamily: `${secret};}`, width: 1.5, hideAfterMs: -1 },
      shortcuts: { selectRegion: 'Ctrl + Alt', togglePause: 5 },
    })
    assert.deepEqual(settings, defaultSettings())
    assert.deepEqual(
      [...warnings].sort(),
      [
        'invalid engines',
        'invalid from',
        'invalid overlay.fontFamily',
        'invalid overlay.fontSize',
        'invalid overlay.hideAfterMs',
        'invalid overlay.opacity',
        'invalid overlay.width',
        'invalid shortcuts.selectRegion',
        'invalid shortcuts.togglePause',
      ].sort(),
    )
    assert.ok(warnings.every((w) => !w.includes(secret)), 'los avisos no incluyen valores')
  })

  test('los campos válidos se conservan aunque otros no lo sean', () => {
    const { settings, warnings } = parseSettings({ ...defaultSettings(), from: 'fr', engines: 'turbo' })
    assert.equal(settings.from, 'fr')
    assert.equal(settings.engines, 'real')
    assert.deepEqual(warnings, ['invalid engines'])
  })

  test('secciones con el tipo equivocado se reemplazan por completo', () => {
    const { settings, warnings } = parseSettings({ ...defaultSettings(), overlay: 'x', shortcuts: [] })
    assert.deepEqual(settings.overlay, defaultSettings().overlay)
    assert.deepEqual(settings.shortcuts, defaultSettings().shortcuts)
    assert.deepEqual([...warnings].sort(), ['invalid overlay', 'invalid shortcuts'])
  })

  test('los idiomas iguales se rechazan', () => {
    const { settings, warnings } = parseSettings({ ...defaultSettings(), from: 'fr', to: 'fr' })
    assert.deepEqual([settings.from, settings.to], ['en', 'es'])
    assert.deepEqual(warnings, ['from and to must differ'])
  })

  test('una región incompleta, fuera de rango o con el tipo equivocado se descarta', () => {
    for (const lastRegion of [
      { x: 1, y: 1, width: 0, height: 5, monitor: 0 },
      { x: 1, y: 1, width: 5 },
      { x: 1.5, y: 1, width: 5, height: 5, monitor: 0 },
      { x: 1, y: 1, width: 5, height: 5, monitor: -1 },
      'x',
      7,
    ]) {
      const { settings, warnings } = parseSettings({ ...defaultSettings(), lastRegion })
      assert.equal(settings.lastRegion, null, JSON.stringify(lastRegion))
      assert.ok(warnings.includes('invalid lastRegion') || warnings.some((w) => w.startsWith('invalid lastRegion')), JSON.stringify(lastRegion))
    }
    assert.equal(parseSettings({ ...defaultSettings(), lastRegion: null }).warnings.length, 0)
  })

  test('modelsDir acepta null o una ruta no vacía', () => {
    assert.equal(parseSettings({ ...defaultSettings(), modelsDir: '' }).settings.modelsDir, null)
    assert.deepEqual(parseSettings({ ...defaultSettings(), modelsDir: '' }).warnings, ['invalid modelsDir'])
    assert.equal(parseSettings({ ...defaultSettings(), modelsDir: 5 }).settings.modelsDir, null)
    assert.equal(parseSettings({ ...defaultSettings(), modelsDir: '/m' }).settings.modelsDir, '/m')
  })

  test('los límites son inclusivos', () => {
    const edges = parseSettings({ ...defaultSettings(), overlay: { ...defaultSettings().overlay, opacity: 0.1, fontSize: 96, width: 200 } })
    assert.deepEqual(edges.warnings, [])
    const outside = parseSettings({ ...defaultSettings(), overlay: { ...defaultSettings().overlay, opacity: 0.09 } })
    assert.deepEqual(outside.warnings, ['invalid overlay.opacity'])
  })

  test('NaN e Infinity no son números válidos', () => {
    const { warnings } = parseSettings({ ...defaultSettings(), overlay: { ...defaultSettings().overlay, opacity: Number.NaN, width: Number.POSITIVE_INFINITY } })
    assert.deepEqual([...warnings].sort(), ['invalid overlay.opacity', 'invalid overlay.width'])
  })
})

describe('applyPatch', () => {
  test('mezcla los campos y las secciones sin perder lo demás', () => {
    const result = applyPatch(defaultSettings(), { to: 'fr', overlay: { opacity: 0.4 } })
    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.settings.to, 'fr')
    assert.equal(result.settings.overlay.opacity, 0.4)
    assert.equal(result.settings.overlay.fontSize, defaultSettings().overlay.fontSize)
    assert.equal(result.settings.from, 'en')
  })

  test('si algún campo es inválido no cambia nada y devuelve los errores', () => {
    const current = defaultSettings()
    const result = applyPatch(current, { to: 'fr', overlay: { opacity: 99 } })
    assert.deepEqual(result, { ok: false, errors: ['invalid overlay.opacity'] })
    assert.deepEqual(current, defaultSettings(), 'el original no se modifica')
  })

  test('rechaza ajustes desconocidos, la versión y parches que no son objetos', () => {
    for (const patch of [{ nope: 1 }, { version: 5 }, null, 'x', []]) {
      assert.equal(applyPatch(defaultSettings(), patch).ok, false, JSON.stringify(patch))
    }
  })

  test('rechaza dejar los dos idiomas iguales', () => {
    assert.deepEqual(applyPatch(defaultSettings(), { from: 'es' }), { ok: false, errors: ['from and to must differ'] })
  })

  test('se puede borrar la región recordada con null', () => {
    const withRegion = { ...defaultSettings(), lastRegion: { x: 1, y: 1, width: 5, height: 5, monitor: 0 } }
    const result = applyPatch(withRegion, { lastRegion: null })
    assert.ok(result.ok)
    if (result.ok) assert.equal(result.settings.lastRegion, null)
  })

  test('guarda una región completa', () => {
    const result = applyPatch(defaultSettings(), { lastRegion: { x: 1, y: 2, width: 30, height: 40, monitor: 0 } })
    assert.ok(result.ok)
    if (result.ok) assert.deepEqual(result.settings.lastRegion, { x: 1, y: 2, width: 30, height: 40, monitor: 0 })
  })
})

describe('modo y fallback', () => {
  test('por defecto: automático, 3 s y atajo de modo', () => {
    const settings = defaultSettings()
    assert.equal(settings.mode, 'auto')
    assert.equal(settings.fallbackSeconds, 3)
    assert.equal(settings.shortcuts.toggleMode, 'CommandOrControl+Shift+M')
  })

  test('unos ajustes antiguos sin estos campos se completan sin avisos', () => {
    const { shortcuts, ...rest } = defaultSettings()
    const { mode: _m, fallbackSeconds: _f, ...old } = rest
    const result = parseSettings({ ...old, shortcuts: { selectRegion: shortcuts.selectRegion, togglePause: shortcuts.togglePause } })
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.settings, defaultSettings())
  })

  test('los tres modos son válidos y otro valor vuelve al de por defecto', () => {
    for (const mode of ['auto', 'text', 'audio']) assert.equal(applyPatch(defaultSettings(), { mode }).ok, true, mode)
    const bad = parseSettings({ ...defaultSettings(), mode: 'both' })
    assert.deepEqual(bad.warnings, ['invalid mode'])
    assert.equal(bad.settings.mode, 'auto')
  })

  test('la espera del fallback es un entero de 1 a 60', () => {
    for (const value of [1, 3, 60]) assert.equal(applyPatch(defaultSettings(), { fallbackSeconds: value }).ok, true, String(value))
    for (const value of [0, 61, 2.5, '5', null]) {
      const result = applyPatch(defaultSettings(), { fallbackSeconds: value })
      assert.deepEqual(result, { ok: false, errors: ['invalid fallbackSeconds'] }, String(value))
    }
  })

  test('el atajo de modo se valida como los otros', () => {
    assert.equal(applyPatch(defaultSettings(), { shortcuts: { toggleMode: 'Alt+M' } }).ok, true)
    assert.deepEqual(applyPatch(defaultSettings(), { shortcuts: { toggleMode: 'Alt + M' } }), { ok: false, errors: ['invalid shortcuts.toggleMode'] })
  })
})
