import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { defaultSettings } from '../shared/settings.ts'
import { SettingsStore } from './settings-store.ts'

const store = () => {
  const s = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'tr-reset-')), 'settings.json'))
  s.load()
  return s
}

test('restablecer devuelve las preferencias a su valor por defecto y conserva región y carpeta', () => {
  const s = store()
  const region = { x: 5, y: 6, width: 200, height: 90, monitor: 0 }
  assert.ok(s.update({ targets: ['fr'], mode: 'audio', modelsDir: '/modelos', lastRegion: region, overlay: { fontSize: 60, textColor: '#ffee00' }, performance: { beamWidth: 4 } }).ok)
  const seen: string[] = []
  s.onChange((c) => seen.push(c.targets.join()))

  const result = s.reset()
  assert.ok(result.ok)
  const now = s.get()
  assert.deepEqual({ ...now, lastRegion: null, modelsDir: null }, defaultSettings())
  assert.equal(now.modelsDir, '/modelos')
  assert.deepEqual(now.lastRegion, region)
  assert.deepEqual(seen, ['es'], 'avisa una vez a los suscriptores')
})

test('replace aplica unas preferencias ya validadas y las guarda', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tr-replace-')), 'settings.json')
  const s = new SettingsStore(file)
  s.load()
  const next = { ...defaultSettings(), from: 'fr', targets: ['en'] }
  assert.ok(s.replace(next).ok)
  const again = new SettingsStore(file)
  assert.equal(again.load().settings.from, 'fr')
})
