'use strict'

const { test, afterEach, describe } = require('node:test')
const assert = require('node:assert/strict')
const api = require('../api.js')

const FAST = { frameIntervalMs: 5 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(5)
  }
  return predicate()
}

afterEach(() => {
  api.stop()
})

describe('fuentes de audio', () => {
  test('listAudioSources devuelve la forma acordada', () => {
    api.configure(FAST)
    const list = api.listAudioSources()
    assert.equal(list.supported, true)
    assert.ok(Array.isArray(list.apps) && list.apps.length > 0)
    for (const app of list.apps) {
      assert.equal(typeof app.id, 'number')
      assert.equal(typeof app.name, 'string')
      assert.ok(app.name.length > 0)
    }
  })

  test('con el motor real la lista es síncrona y de una de las dos formas', () => {
    api.configure({ ...FAST, engines: 'real' })
    const list = api.listAudioSources()
    if (list.supported) assert.ok(Array.isArray(list.apps))
    else assert.equal(typeof list.reason, 'string')
    api.configure(FAST)
  })

  test('una fuente inválida falla con InvalidArg y no arranca nada', async () => {
    api.configure(FAST)
    const events = []
    const off = [api.onSubtitle((e) => events.push(e)), api.onAudioLevel((e) => events.push(e))]
    const bad = [
      { kind: 'microphone' },
      { kind: 'app' },
      { kind: 'app', name: 'firefox.exe' },
      { kind: '' },
    ]
    for (const source of bad) {
      assert.throws(
        () => api.startAudioSubtitles('en', ['es'], source),
        (error) => error.code === 'InvalidArg',
        JSON.stringify(source),
      )
    }
    await sleep(200)
    assert.deepEqual(events, [], 'ningún motor debió arrancar')
    off.forEach((f) => f())
  })

  test('una aplicación inexistente falla sin dejar nada en marcha', async () => {
    api.configure(FAST)
    const events = []
    const off = api.onSubtitle((e) => events.push(e))
    assert.throws(() => api.startAudioSubtitles('en', ['es'], { kind: 'app', id: 424242, name: 'ghost.exe' }))
    await sleep(200)
    assert.deepEqual(events, [])
    off()
  })

  test('startAudioSubtitles(from, to) sin fuente sigue funcionando', async () => {
    api.configure({ ...FAST, fakeLatencyMs: 0 })
    const subtitles = []
    const off = api.onSubtitle((e) => subtitles.push(e))
    api.startAudioSubtitles('en', ['es'])
    assert.ok(await waitFor(() => subtitles.length > 0))
    off()
  })

  test('una aplicación de la lista arranca y la fuente "system" explícita también', async () => {
    api.configure(FAST)
    const [app] = api.listAudioSources().apps
    for (const source of [{ kind: 'system' }, { kind: 'app', id: app.id, name: app.name }]) {
      const subtitles = []
      const off = api.onSubtitle((e) => subtitles.push(e))
      api.startAudioSubtitles('en', ['es'], source)
      assert.ok(await waitFor(() => subtitles.length > 0), JSON.stringify(source))
      off()
      api.stop()
    }
  })

  test('onAudioLevel entrega solo números y se detiene con stop', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    api.startAudioSubtitles('en', ['es'])
    assert.ok(await waitFor(() => levels.length >= 3))
    for (const level of levels) {
      assert.deepEqual(Object.keys(level).sort(), ['peak', 'rms'])
      assert.equal(typeof level.rms, 'number')
      assert.equal(typeof level.peak, 'number')
      assert.ok(level.rms >= 0 && level.peak <= 1 && level.peak >= level.rms - 1e-6)
    }
    assert.ok(levels.some((l) => l.rms > 0), 'el habla de demostración tiene nivel')
    api.stop()
    const after = levels.length
    await sleep(300)
    assert.equal(levels.length, after, 'sin niveles tras stop')
    off()
  })

  test('el umbral de voz es un número entre 0 y 1 que viene del motor', () => {
    const threshold = api.audioVoiceThreshold()
    assert.equal(typeof threshold, 'number')
    assert.ok(threshold > 0 && threshold < 1)
  })
})
