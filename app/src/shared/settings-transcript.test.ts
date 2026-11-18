import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyPatch, defaultSettings, parseSettings } from './settings.ts'
import { exportSettings, importSettings } from './settings-transfer.ts'

describe('ajustes de transcripción', () => {
  test('por defecto el guardado está desactivado, sin carpeta y con .srt', () => {
    assert.deepEqual(defaultSettings().transcript, { enabled: false, dir: null, srt: true })
  })

  test('un archivo antiguo sin la clave toma los valores por defecto sin avisos', () => {
    const { transcript: _t, ...old } = defaultSettings()
    const { settings, warnings } = parseSettings(old)
    assert.deepEqual(warnings, [])
    assert.deepEqual(settings.transcript, defaultSettings().transcript)
  })

  test('activar sin carpeta se rechaza', () => {
    const result = applyPatch(defaultSettings(), { transcript: { enabled: true } })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && result.errors.includes('invalid transcript.enabled'))
  })

  test('activar con carpeta se acepta y conserva el resto de la sección', () => {
    const result = applyPatch(defaultSettings(), { transcript: { enabled: true, dir: '/home/u/transcripciones' } })
    assert.ok(result.ok)
    assert.deepEqual(result.settings.transcript, { enabled: true, dir: '/home/u/transcripciones', srt: true })
  })

  test('valores de tipo incorrecto se rechazan', () => {
    assert.equal(applyPatch(defaultSettings(), { transcript: { srt: 'sí' as unknown as boolean } }).ok, false)
    assert.equal(applyPatch(defaultSettings(), { transcript: { dir: '' } }).ok, false)
  })

  test('un archivo con el guardado activo y sin carpeta se lee desactivado', () => {
    const raw = { ...defaultSettings(), transcript: { enabled: true, dir: null, srt: false } }
    const { settings, warnings } = parseSettings(raw)
    assert.equal(settings.transcript.enabled, false)
    assert.equal(settings.transcript.srt, false)
    assert.deepEqual(warnings, ['invalid transcript.enabled'])
  })
})

describe('exportar e importar', () => {
  const active = { ...defaultSettings(), transcript: { enabled: true, dir: '/privado', srt: true } }

  test('la exportación no lleva ninguna preferencia de transcripción', () => {
    const exported = exportSettings(active)
    assert.equal('transcript' in exported.settings, false)
    assert.doesNotMatch(JSON.stringify(exported), /privado|transcript/)
  })

  test('importar conserva la transcripción actual y no puede activarla', () => {
    const file = JSON.stringify(exportSettings(defaultSettings()))
    const result = importSettings(file, active)
    assert.ok(result.ok)
    assert.deepEqual(result.settings.transcript, active.transcript)

    const off = defaultSettings()
    const forced = JSON.parse(file) as { settings: Record<string, unknown> }
    forced.settings['transcript'] = { enabled: true, dir: '/otra', srt: true }
    const rejected = importSettings(JSON.stringify(forced), off)
    assert.equal(rejected.ok, false)
  })
})
