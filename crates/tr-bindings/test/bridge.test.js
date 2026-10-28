'use strict'

const { test, afterEach, describe } = require('node:test')
const assert = require('node:assert/strict')
const api = require('../api.js')

const FAST = { frameIntervalMs: 5 }
const REGION = { x: 0, y: 0, width: 32, height: 32 }

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

describe('comandos', () => {
  test('expone la API acordada', () => {
    for (const name of [
      'configure',
      'startRegionTranslation',
      'startAudioSubtitles',
      'stop',
      'onTranslation',
      'onSubtitle',
      'onError',
      'onModelProgress',
      'onModeChanged',
    ]) {
      assert.equal(typeof api[name], 'function', name)
    }
  })

  test('los argumentos inválidos fallan con un error descriptivo y no inician el motor', async () => {
    api.configure(FAST)
    const events = []
    const off = [
      api.onTranslation((e) => events.push(e)),
      api.onSubtitle((e) => events.push(e)),
    ]
    const cases = [
      [() => api.startRegionTranslation({ ...REGION, width: 0 }, 'en', ['es']), /region must not be empty/],
      [() => api.startRegionTranslation({ ...REGION, height: 0 }, 'en', ['es']), /region must not be empty/],
      [() => api.startRegionTranslation(REGION, 'english', ['es']), /unknown language code/],
      [() => api.startRegionTranslation(REGION, 'en', ['']), /unknown language code/],
      [() => api.startRegionTranslation(REGION, 'en', ['en']), /must differ/],
      [() => api.startAudioSubtitles('zz1', ['es']), /unknown language code/],
      [() => api.startAudioSubtitles('es', ['ES']), /must differ/],
      [() => api.startRegionTranslation(REGION, 'en', ['es', 'fr', 'de']), /at most 2 target languages/],
      [() => api.startRegionTranslation(REGION, 'en', ['es', 'es']), /different from each other/],
      [() => api.startAudioSubtitles('en', ['es', 'fr', 'it']), /at most 2 target languages/],
    ]
    for (const [call, message] of cases) {
      assert.throws(call, (error) => error.code === 'InvalidArg' && message.test(error.message))
    }
    await sleep(150)
    assert.deepEqual(events, [], 'ningún motor debió arrancar')
    off.forEach((f) => f())
  })

  test('un arranque inválido no interrumpe lo que ya estaba en marcha', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.throws(() => api.startRegionTranslation(REGION, 'en', ['en']))
    assert.ok(await waitFor(() => events.length >= 1), 'la sesión original sigue emitiendo')
  })

  test('stop es idempotente y arrancar/parar se puede repetir', async () => {
    api.configure(FAST)
    api.stop()
    api.stop()
    for (let i = 0; i < 5; i++) {
      api.startRegionTranslation(REGION, 'en', ['es'])
      api.stop()
    }
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => events.length >= 1))
  })
})

describe('eventos', () => {
  test('onTranslation recibe original, traducción y marca de tiempo', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => events.length >= 2), 'llegan traducciones')
    assert.deepEqual(Object.keys(events[0]).sort(), ['original', 'timestampMs', 'translations'])
    assert.equal(events[0].original, 'Hello, world')
    assert.deepEqual(events[0].translations, [{ lang: 'es', text: '[es] Hello, world' }])
    assert.equal(typeof events[0].timestampMs, 'number')
    assert.ok(events[1].timestampMs >= events[0].timestampMs)
  })

  test('onSubtitle recibe subtítulos finales traducidos del audio', async () => {
    api.configure(FAST)
    const events = []
    api.onSubtitle((e) => events.push(e))
    api.startAudioSubtitles('en', ['es'])
    assert.ok(await waitFor(() => events.some((e) => e.isFinal)), 'llega un subtítulo final')
    const final = events.find((e) => e.isFinal)
    assert.equal(final.original, 'Good morning everyone')
    assert.deepEqual(final.translations, [{ lang: 'es', text: '[es] Good morning everyone' }])
  })

  test('con dos destinos el evento lleva las dos traducciones en el orden pedido', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['fr', 'es'])
    assert.ok(await waitFor(() => events.length >= 1), 'llega una traducción')
    assert.deepEqual(events[0].translations, [
      { lang: 'fr', text: '[fr] Hello, world' },
      { lang: 'es', text: '[es] Hello, world' },
    ])
  })

  test('sin destinos el evento lleva el original y ninguna traducción', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', [])
    assert.ok(await waitFor(() => events.length >= 1), 'llega el texto')
    assert.equal(events[0].original, 'Hello, world')
    assert.deepEqual(events[0].translations, [])
  })

  test('onModeChanged informa el modo inicial con el fallback activado', async () => {
    api.configure({ ...FAST, autoFallback: true })
    const modes = []
    api.onModeChanged((e) => modes.push(e.mode))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => modes.length >= 1))
    assert.equal(modes[0], 'text')
  })

  test('la baja de una suscripción deja de entregar eventos', async () => {
    api.configure(FAST)
    const a = []
    const b = []
    const offA = api.onTranslation((e) => a.push(e))
    api.onTranslation((e) => b.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => a.length >= 1 && b.length >= 1), 'ambos reciben')
    offA()
    const seen = a.length
    assert.ok(await waitFor(() => b.length >= 2))
    assert.equal(a.length, seen)
  })

  test('los listeners deben ser funciones', () => {
    assert.throws(() => api.onTranslation(null), TypeError)
  })

  test('tras stop no llega ningún evento más', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.onModeChanged((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => events.length >= 1))
    api.stop()
    const count = events.length
    await sleep(250)
    assert.equal(events.length, count)
  })
})

describe('no bloqueo', () => {
  test('con un motor lento el hilo de JS sigue respondiendo', async () => {
    api.configure({ ...FAST, fakeLatencyMs: 300 })

    const started = performance.now()
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(performance.now() - started < 100, 'el comando retorna sin esperar al motor')

    // Temporizador de 10 ms durante ~700 ms: si el motor bloqueara el hilo habría huecos grandes.
    let last = performance.now()
    let worstGap = 0
    const timer = setInterval(() => {
      const now = performance.now()
      worstGap = Math.max(worstGap, now - last)
      last = now
    }, 10)
    await sleep(700)
    clearInterval(timer)
    assert.ok(worstGap < 100, `mayor hueco del bucle de eventos: ${worstGap.toFixed(1)} ms`)

    const stopStarted = performance.now()
    api.stop()
    assert.ok(performance.now() - stopStarted < 1000, 'stop espera como mucho a la operación en curso')
  })
})
