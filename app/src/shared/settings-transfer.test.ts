import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { defaultSettings } from './settings.ts'
import { EXPORT_FORMAT, exportSettings, importSettings, MAX_IMPORT_BYTES } from './settings-transfer.ts'

const withLocalData = () => ({
  ...defaultSettings(),
  modelsDir: '/home/secreto/modelos',
  lastRegion: { x: 1, y: 2, width: 300, height: 100, monitor: 0 },
})

describe('exportar', () => {
  test('no incluye la región ni la carpeta de modelos', () => {
    const exported = exportSettings(withLocalData())
    const text = JSON.stringify(exported)
    assert.equal(exported.format, EXPORT_FORMAT)
    assert.ok(!('lastRegion' in exported.settings) && !('modelsDir' in exported.settings))
    assert.ok(!text.includes('secreto') && !text.includes('lastRegion') && !text.includes('modelsDir'))
  })

  test('no modifica los ajustes originales', () => {
    const current = withLocalData()
    exportSettings(current)
    assert.equal(current.modelsDir, '/home/secreto/modelos')
  })
})

describe('importar', () => {
  test('lo exportado se importa igual y conserva la región y la carpeta locales', () => {
    const source = { ...withLocalData(), from: 'en', targets: ['fr'] }
    source.overlay.fontSize = 40
    const target = { ...defaultSettings(), modelsDir: '/otro', lastRegion: null }
    const result = importSettings(JSON.stringify(exportSettings(source)), target)
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepEqual(result.settings.targets, ['fr'])
    assert.equal(result.settings.overlay.fontSize, 40)
    assert.equal(result.settings.modelsDir, '/otro')
    assert.equal(result.settings.lastRegion, null)
  })

  test('los campos que faltan toman su valor por defecto', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings: { overlay: { fontSize: 33 } } })
    const result = importSettings(text, withLocalData())
    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.settings.overlay.fontSize, 33)
    assert.equal(result.settings.overlay.opacity, defaultSettings().overlay.opacity)
    assert.deepEqual(result.settings.lastRegion, withLocalData().lastRegion)
  })

  test('un valor inválido rechaza todo, nombrando el campo', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings: { overlay: { opacity: 7, fontSize: 30 } } })
    assert.deepEqual(importSettings(text, defaultSettings()), { ok: false, errors: ['invalid overlay.opacity'] })
  })

  test('rechaza campos locales y desconocidos', () => {
    const wrap = (settings: unknown) => JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings })
    assert.deepEqual(importSettings(wrap({ modelsDir: '/x' }), defaultSettings()), { ok: false, errors: ['modelsDir is not imported'] })
    assert.deepEqual(importSettings(wrap({ lastRegion: null }), defaultSettings()), { ok: false, errors: ['lastRegion is not imported'] })
    assert.deepEqual(importSettings(wrap({ hack: 1 }), defaultSettings()), { ok: false, errors: ['unknown setting hack'] })
  })

  test('rechaza texto que no es JSON, otro formato u otra versión', () => {
    const current = defaultSettings()
    assert.equal(importSettings('no json', current).ok, false)
    assert.equal(importSettings('[]', current).ok, false)
    assert.equal(importSettings(JSON.stringify({ format: 'otro', version: 1, settings: {} }), current).ok, false)
    assert.equal(importSettings(JSON.stringify({ format: EXPORT_FORMAT, version: 99, settings: {} }), current).ok, false)
    assert.equal(importSettings(JSON.stringify({ format: EXPORT_FORMAT, version: 1 }), current).ok, false)
  })

  test('rechaza archivos desmesurados', () => {
    const big = JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings: { pad: 'x'.repeat(MAX_IMPORT_BYTES) } })
    assert.deepEqual(importSettings(big, defaultSettings()), { ok: false, errors: ['import too large'] })
  })

  test('los idiomas iguales rechazan la importación', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings: { from: 'es', targets: ['es'] } })
    assert.deepEqual(importSettings(text, defaultSettings()), { ok: false, errors: ['from and to must differ'] })
  })
})

describe('importar archivos del formato anterior', () => {
  test('un archivo con `to` se importa como un destino', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, settings: { from: 'en', to: 'fr' } })
    const result = importSettings(text, defaultSettings())
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepEqual(result.settings.targets, ['fr'])
  })
})
