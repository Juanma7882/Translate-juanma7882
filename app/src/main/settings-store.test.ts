import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { defaultSettings } from '../shared/settings.ts'
import { SettingsStore } from './settings-store.ts'

const scratch = () => mkdtempSync(join(tmpdir(), 'tr-settings-'))
const fileIn = (dir: string) => join(dir, 'nested', 'settings.json')

describe('SettingsStore', () => {
  test('el primer uso (sin archivo) da los valores por defecto sin avisos y no crea nada', () => {
    const dir = scratch()
    const store = new SettingsStore(fileIn(dir))
    const { settings, warnings } = store.load()
    assert.deepEqual(settings, defaultSettings())
    assert.deepEqual(warnings, [])
    assert.deepEqual(readdirSync(dir), [])
  })

  test('lo guardado se recupera tras reiniciar', () => {
    const file = fileIn(scratch())
    const first = new SettingsStore(file)
    first.load()
    const result = first.update({ to: 'fr', lastRegion: { x: 10, y: 20, width: 300, height: 80, monitor: 0 }, overlay: { opacity: 0.4 } })
    assert.ok(result.ok)

    const second = new SettingsStore(file)
    const { settings, warnings } = second.load()
    assert.deepEqual(warnings, [])
    assert.equal(settings.to, 'fr')
    assert.deepEqual(settings.lastRegion, { x: 10, y: 20, width: 300, height: 80, monitor: 0 })
    assert.equal(settings.overlay.opacity, 0.4)
  })

  test('un archivo dañado da los valores por defecto y un aviso sin contenido', () => {
    const dir = scratch()
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{ this is not json SECRET-CONTENT')
    const { settings, warnings } = new SettingsStore(file).load()
    assert.deepEqual(settings, defaultSettings())
    assert.deepEqual(warnings, ['settings file is damaged; using defaults'])
  })

  test('una carpeta en lugar de un archivo se trata como no legible', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'settings.json'))
    const { settings, warnings } = new SettingsStore(join(dir, 'settings.json')).load()
    assert.deepEqual(settings, defaultSettings())
    assert.deepEqual(warnings, ['settings file could not be read; using defaults'])
  })

  test('una versión desconocida o campos inválidos avisan y se corrigen', () => {
    const dir = scratch()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ ...defaultSettings(), version: 99 }))
    assert.deepEqual(new SettingsStore(file).load().warnings, ['unknown settings version'])

    writeFileSync(file, JSON.stringify({ ...defaultSettings(), overlay: { ...defaultSettings().overlay, opacity: 50 } }))
    const { settings, warnings } = new SettingsStore(file).load()
    assert.equal(settings.overlay.opacity, defaultSettings().overlay.opacity)
    assert.deepEqual(warnings, ['invalid overlay.opacity'])
  })

  test('un parche inválido no cambia nada, no toca el archivo y no avisa a nadie', () => {
    const file = fileIn(scratch())
    const store = new SettingsStore(file)
    store.load()
    store.update({ to: 'fr' })
    const before = readFileSync(file, 'utf8')
    let notified = 0
    store.onChange(() => notified++)

    const result = store.update({ overlay: { opacity: 5 } })
    assert.deepEqual(result, { ok: false, errors: ['invalid overlay.opacity'] })
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(store.get().overlay.opacity, defaultSettings().overlay.opacity)
    assert.equal(notified, 0)
  })

  test('la escritura es atómica: no quedan archivos temporales y el JSON siempre es válido', () => {
    const file = fileIn(scratch())
    const store = new SettingsStore(file)
    store.load()
    for (let i = 0; i < 20; i++) assert.ok(store.update({ overlay: { fontSize: 20 + i } }).ok)
    const dir = join(file, '..')
    assert.deepEqual(readdirSync(dir), ['settings.json'])
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).overlay.fontSize, 39)
  })

  test('los suscriptores reciben una copia de los ajustes nuevos y pueden darse de baja', () => {
    const store = new SettingsStore(fileIn(scratch()))
    store.load()
    const seen: string[] = []
    const off = store.onChange((s) => seen.push(s.to))
    store.update({ to: 'fr' })
    off()
    store.update({ to: 'de' })
    assert.deepEqual(seen, ['fr'])
  })

  test('get devuelve copias: modificarlas no altera el estado', () => {
    const store = new SettingsStore(fileIn(scratch()))
    store.load()
    const copy = store.get()
    copy.to = 'zz'
    copy.overlay.opacity = 0.1
    assert.equal(store.get().to, defaultSettings().to)
    assert.equal(store.get().overlay.opacity, defaultSettings().overlay.opacity)
  })

  test('el archivo guardado solo contiene preferencias', () => {
    const file = fileIn(scratch())
    const store = new SettingsStore(file)
    store.load()
    store.update({ from: 'ja', to: 'en' })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(Object.keys(saved).sort(), ['engines', 'from', 'lastRegion', 'modelsDir', 'overlay', 'shortcuts', 'to', 'version'])
  })
})
