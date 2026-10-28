import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyPatch, defaultSettings, parseSettings } from './settings.ts'
import { exportSettings, importSettings } from './settings-transfer.ts'

const app = (program: unknown) => ({ ...defaultSettings(), audioSource: { kind: 'app', program } })

describe('audioSource', () => {
  test('por defecto es todo el sistema y los ajustes antiguos sin el campo lo reciben sin avisos', () => {
    assert.deepEqual(defaultSettings().audioSource, { kind: 'system' })
    const { audioSource: _a, ...old } = defaultSettings()
    const { settings, warnings } = parseSettings(old)
    assert.deepEqual(settings.audioSource, { kind: 'system' })
    assert.deepEqual(warnings, [])
  })

  test('acepta una aplicación por nombre de programa', () => {
    const { settings, warnings } = parseSettings(app('firefox.exe'))
    assert.deepEqual(settings.audioSource, { kind: 'app', program: 'firefox.exe' })
    assert.deepEqual(warnings, [])
    assert.equal(parseSettings(app('Discord (canary).exe')).warnings.length, 0)
  })

  test('rechaza nombres vacíos, largos, con rutas o caracteres de control', () => {
    const bad = ['', '   ', ' firefox.exe', 'a'.repeat(129), 'C:\\Windows\\x.exe', '/usr/bin/firefox', '..\\x.exe', '..', 'a\u0000b', 'a\nb', 42, null, undefined]
    for (const program of bad) {
      const { settings, warnings } = parseSettings(app(program))
      assert.deepEqual(settings.audioSource, { kind: 'system' }, String(program))
      assert.deepEqual(warnings, ['invalid audioSource'], String(program))
    }
  })

  test('rechaza tipos desconocidos y campos de más', () => {
    for (const value of [{ kind: 'mic' }, { kind: 'system', program: 'x.exe' }, { kind: 'app', program: 'x.exe', id: 3 }, 'system', 7, []]) {
      const { settings, warnings } = parseSettings({ ...defaultSettings(), audioSource: value })
      assert.deepEqual(settings.audioSource, { kind: 'system' })
      assert.deepEqual(warnings, ['invalid audioSource'])
    }
  })

  test('el parche cambia solo la fuente y volver a sistema no arrastra el programa', () => {
    const first = applyPatch(defaultSettings(), { audioSource: { kind: 'app', program: 'chrome.exe' } })
    assert.ok(first.ok)
    assert.deepEqual(first.settings.audioSource, { kind: 'app', program: 'chrome.exe' })
    assert.equal(first.settings.to, defaultSettings().to)
    const back = applyPatch(first.settings, { audioSource: { kind: 'system' } })
    assert.ok(back.ok)
    assert.deepEqual(back.settings.audioSource, { kind: 'system' })
    assert.deepEqual(applyPatch(defaultSettings(), { audioSource: { kind: 'app', program: '..\\x' } }), { ok: false, errors: ['invalid audioSource'] })
  })

  test('viaja en la exportación y se importa; una fuente inválida rechaza todo', () => {
    const source = { ...defaultSettings(), audioSource: { kind: 'app' as const, program: 'discord.exe' } }
    const exported = exportSettings(source)
    assert.deepEqual(exported.settings.audioSource, { kind: 'app', program: 'discord.exe' })
    const result = importSettings(JSON.stringify(exported), defaultSettings())
    assert.ok(result.ok)
    assert.deepEqual(result.settings.audioSource, { kind: 'app', program: 'discord.exe' })

    const back = importSettings(JSON.stringify(exportSettings(defaultSettings())), source)
    assert.ok(back.ok)
    assert.deepEqual(back.settings.audioSource, { kind: 'system' })

    const broken = JSON.stringify({ ...exported, settings: { ...exported.settings, audioSource: { kind: 'app', program: 'C:\\x.exe' } } })
    assert.deepEqual(importSettings(broken, defaultSettings()), { ok: false, errors: ['invalid audioSource'] })
  })
})
