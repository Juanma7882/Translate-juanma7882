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
  api.stopAudioMonitor()
  api.stop()
})

describe('escucha previa del nivel', () => {
  test('emite niveles sin sesión y sin nada que no sean números', async () => {
    api.configure(FAST)
    const levels = []
    const content = []
    const off = [
      api.onAudioLevel((e) => levels.push(e)),
      api.onSubtitle((e) => content.push(e)),
      api.onTranslation((e) => content.push(e)),
    ]
    assert.equal(api.startAudioMonitor(), true)
    assert.ok(await waitFor(() => levels.length >= 3))
    for (const level of levels) {
      assert.deepEqual(Object.keys(level).sort(), ['peak', 'rms'])
      assert.equal(typeof level.rms, 'number')
      assert.ok(level.rms >= 0 && level.peak <= 1 && level.peak >= level.rms - 1e-6)
    }
    assert.ok(levels.some((l) => l.rms > 0), 'el audio de demostración tiene nivel')
    assert.deepEqual(content, [], 'sin sesión no hay subtítulos ni traducciones')
    off.forEach((f) => f())
  })

  test('stopAudioMonitor corta los niveles de inmediato y es idempotente', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    api.startAudioMonitor({ kind: 'system' })
    assert.ok(await waitFor(() => levels.length >= 2))
    api.stopAudioMonitor()
    const after = levels.length
    await sleep(300)
    assert.equal(levels.length, after, 'sin niveles tras stopAudioMonitor')
    api.stopAudioMonitor()
    off()
  })

  test('una aplicación de la lista se puede escuchar', async () => {
    api.configure(FAST)
    const [app] = api.listAudioSources().apps
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    assert.equal(api.startAudioMonitor({ kind: 'app', id: app.id, name: app.name }), true)
    assert.ok(await waitFor(() => levels.some((l) => l.rms > 0)))
    off()
  })

  test('una fuente inválida falla con InvalidArg y no abre nada', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    for (const source of [{ kind: 'microphone' }, { kind: 'app' }, { kind: 'app', name: 'firefox.exe' }, { kind: '' }]) {
      assert.throws(
        () => api.startAudioMonitor(source),
        (error) => error.code === 'InvalidArg',
        JSON.stringify(source),
      )
    }
    await sleep(200)
    assert.deepEqual(levels, [])
    off()
  })

  test('una aplicación inexistente falla con el motivo y no deja nada midiendo', async () => {
    api.configure(FAST)
    const levels = []
    const errors = []
    const off = [api.onAudioLevel((e) => levels.push(e)), api.onError((e) => errors.push(e))]
    assert.throws(
      () => api.startAudioMonitor({ kind: 'app', id: 424242, name: 'ghost.exe' }),
      (error) => error.code !== 'InvalidArg' && /not playing audio/.test(error.message),
    )
    await sleep(200)
    assert.deepEqual(levels, [])
    assert.deepEqual(errors, [], 'un fallo de la escucha no es un error de sesión')
    off.forEach((f) => f())
  })

  test('una sesión reemplaza la escucha y mientras dure no se puede abrir otra', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    assert.equal(api.startAudioMonitor(), true)
    assert.ok(await waitFor(() => levels.length >= 2))

    api.startAudioSubtitles('en', 'es')
    assert.equal(api.startAudioMonitor(), false, 'con una sesión en marcha la escucha cede')
    // Los niveles siguen llegando, ahora de la sesión.
    const before = levels.length
    assert.ok(await waitFor(() => levels.length > before + 2))

    api.stop()
    const stopped = levels.length
    await sleep(300)
    assert.equal(levels.length, stopped, 'sin sesión ni escucha no llega ningún nivel')

    assert.equal(api.startAudioMonitor(), true, 'al terminar la sesión vuelve a poder escuchar')
    assert.ok(await waitFor(() => levels.length > stopped + 2))
    off()
  })

  test('configure no apaga la escucha', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    api.startAudioMonitor()
    assert.ok(await waitFor(() => levels.length >= 2))
    api.configure({ ...FAST, fakeLatencyMs: 0 })
    const before = levels.length
    assert.ok(await waitFor(() => levels.length > before + 2), 'sigue midiendo tras configure')
    off()
  })

  test('los niveles de una sesión en pausa siguen sin pasar aunque la escucha esté apagada', async () => {
    api.configure(FAST)
    const levels = []
    const off = api.onAudioLevel((e) => levels.push(e))
    api.startRegionTranslation({ x: 0, y: 0, width: 32, height: 32 }, 'en', 'es')
    api.pause()
    await sleep(100)
    const before = levels.length
    await sleep(300)
    assert.equal(levels.length, before)
    off()
  })
})
