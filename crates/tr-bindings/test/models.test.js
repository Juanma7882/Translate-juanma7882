'use strict'

// Pruebas de pausa, configuración de motores y modelos. Las descargas van contra un servidor HTTP
// local y un manifiesto propio (opción `manifestPath`): sin internet y sin bajar cientos de MB.

const { test, afterEach, describe, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const api = require('../api.js')

const FAST = { frameIntervalMs: 5 }
const REGION = { x: 0, y: 0, width: 32, height: 32 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const tempDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `tr-node-${tag}-`))

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(5)
  }
  return predicate()
}

const toClean = []
after(() => toClean.forEach((fn) => fn()))
afterEach(() => api.stop())

/** Sirve archivos por HTTP; con `slow` los envía en trozos con pausas. */
function serve(files, { slow = false } = {}) {
  const hits = {}
  const server = http.createServer((req, res) => {
    const body = files[req.url.slice(1)]
    hits[req.url] = (hits[req.url] ?? 0) + 1
    if (!body) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-length': body.length })
    if (!slow) {
      res.end(body)
      return
    }
    let offset = 0
    const pump = () => {
      if (offset >= body.length) return res.end()
      res.write(body.subarray(offset, offset + 10_000))
      offset += 10_000
      setTimeout(pump, 30)
    }
    pump()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      toClean.push(() => server.close())
      resolve({ port: server.address().port, hits, server })
    }),
  )
}

/** Manifiesto con dos modelos: `o` (OCR, un archivo grande) y `t` (traducción, dos pequeños). */
function writeManifest(port, files) {
  const entry = (name) =>
    `{"name":"${name}","url":"http://127.0.0.1:${port}/${name}","sha256":"${sha256(files[name])}","size":${files[name].length}}`
  const json = `{"version":1,"models":{"o":{"files":[${entry('a.bin')}]},"t":{"files":[${entry('b.bin')},${entry('c.bin')}]}},"ocr":{"en":"o"},"translate":{"en-es":"t"}}`
  const file = path.join(tempDir('manifest'), 'models.json')
  fs.writeFileSync(file, json)
  return file
}

const FILES = {
  'a.bin': Buffer.from(Array.from({ length: 150_000 }, (_, i) => i % 251)),
  'b.bin': Buffer.from('model-b'),
  'c.bin': Buffer.from('model-c-data'),
}

describe('configuración de motores', () => {
  test('un conjunto de motores desconocido, una carpeta relativa o un manifiesto inválido se rechazan', () => {
    const bad = [
      [{ engines: 'turbo' }, /unknown engine set `turbo`/],
      [{ modelsDir: 'relative/models' }, /modelsDir must be an absolute path/],
      [{ manifestPath: '/definitely/not/here.json' }, /could not read the manifest/],
    ]
    for (const [options, message] of bad) {
      assert.throws(() => api.configure(options), (e) => e.code === 'InvalidArg' && message.test(e.message))
    }
  })

  test('una configuración inválida no cambia nada ni detiene la sesión en marcha', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', 'es')
    assert.ok(await waitFor(() => events.length >= 1))

    assert.throws(() => api.configure({ engines: 'turbo' }), (e) => e.code === 'InvalidArg')

    const seen = events.length
    assert.ok(await waitFor(() => events.length > seen + 1), 'la sesión original sigue emitiendo')
  })

  test('los motores reales no arrancan sin modelos y el error lista los que faltan', async () => {
    const { port } = await serve(FILES)
    api.configure({ engines: 'real', modelsDir: tempDir('empty'), manifestPath: writeManifest(port, FILES) })
    const events = []
    api.onTranslation((e) => events.push(e))
    assert.throws(
      () => api.startRegionTranslation(REGION, 'en', 'es'),
      (e) => /missing models: o, t/.test(e.message),
    )
    await sleep(150)
    assert.deepEqual(events, [], 'no se capturó ni se tradujo nada')
  })

  test('los motores reales rechazan un par no soportado como argumento inválido', async () => {
    api.configure({ engines: 'real', modelsDir: tempDir('pair') })
    assert.throws(
      () => api.startRegionTranslation(REGION, 'en', 'fr'),
      (e) => e.code === 'InvalidArg' && /unsupported translation pair/.test(e.message),
    )
    // Los motores reales de audio también exigen sus modelos (reconocimiento de voz + traducción).
    assert.throws(
      () => api.startAudioSubtitles('en', 'es'),
      (e) => /missing models: stt-whisper-base, mt-opus-en-es/.test(e.message),
    )
    assert.throws(
      () => api.startAudioSubtitles('ko', 'es'),
      (e) => e.code === 'InvalidArg' && /unsupported/.test(e.message),
    )
  })
})

describe('pausa y reanudación', () => {
  test('pausar o reanudar sin nada en marcha no falla ni inicia nada', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.pause()
    api.resume()
    api.pause()
    await sleep(150)
    assert.deepEqual(events, [])
  })

  test('durante la pausa no llegan traducciones y al reanudar vuelven', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', 'es')
    assert.ok(await waitFor(() => events.length >= 1))

    api.pause()
    await sleep(100) // deja asentar lo que ya estuviera en vuelo
    const paused = events.length
    await sleep(300)
    assert.equal(events.length, paused, 'ninguna traducción durante la pausa')

    api.resume()
    assert.ok(await waitFor(() => events.length > paused), 'tras reanudar vuelven a llegar')
  })

  test('detener con la sesión en pausa y volver a arrancar funciona', async () => {
    api.configure(FAST)
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', 'es')
    api.pause()
    api.stop()
    api.startRegionTranslation(REGION, 'en', 'es')
    assert.ok(await waitFor(() => events.length >= 1), 'una sesión nueva no hereda la pausa')
  })
})

describe('modelos', () => {
  test('modelStatus devuelve id, estado y tamaño de cada modelo necesario', async () => {
    const { port } = await serve(FILES)
    api.configure({ modelsDir: tempDir('status'), manifestPath: writeManifest(port, FILES) })
    assert.deepEqual(await api.modelStatus('en', 'es'), [
      { id: 'o', state: 'missing', size: 150_000 },
      { id: 't', state: 'missing', size: 19 },
    ])
  })

  test('modelCatalog lista los idiomas con OCR y los pares de traducción del manifiesto', async () => {
    const { port } = await serve(FILES)
    api.configure({ modelsDir: tempDir('catalog'), manifestPath: writeManifest(port, FILES) })
    assert.deepEqual(api.modelCatalog(), { ocrLanguages: ['en'], sttLanguages: [], pairs: [{ from: 'en', to: 'es' }] })
  })

  test('el ámbito audio lista el modelo de voz y la traducción; un ámbito desconocido es InvalidArg', async () => {
    api.configure({ modelsDir: tempDir('scope') })
    const ids = (scope) => api.modelStatus('en', 'es', scope).then((list) => list.map((m) => m.id))
    assert.deepEqual(await ids('audio'), ['stt-whisper-base', 'mt-opus-en-es'])
    assert.deepEqual(await ids('text'), ['ocr-ppocrv6-small', 'mt-opus-en-es'])
    assert.deepEqual(await ids(), await ids('text'), 'por defecto: texto')
    assert.equal((await ids('all')).length, 3)
    await assert.rejects(api.modelStatus('en', 'es', 'video'), (e) => e.code === 'InvalidArg')
    await assert.rejects(api.downloadModels('en', 'es', 'video'), (e) => e.code === 'InvalidArg')
    assert.ok(api.modelCatalog().sttLanguages.includes('ja'))
  })

  test('el catálogo del manifiesto incluido ofrece los pares y los idiomas reales', () => {
    api.configure({ modelsDir: tempDir('embedded-catalog') })
    const catalog = api.modelCatalog()
    assert.deepEqual(catalog.pairs, [{ from: 'en', to: 'es' }, { from: 'es', to: 'en' }])
    for (const lang of ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh']) assert.ok(catalog.ocrLanguages.includes(lang), lang)
  })

  test('los pares y los idiomas no soportados rechazan la promesa con un error descriptivo', async () => {
    const { port } = await serve(FILES)
    api.configure({ modelsDir: tempDir('unsupported'), manifestPath: writeManifest(port, FILES) })
    for (const call of [() => api.modelStatus('en', 'fr'), () => api.downloadModels('ko', 'es')]) {
      await assert.rejects(call(), (e) => e.code === 'InvalidArg' && /unsupported/.test(e.message))
    }
    await assert.rejects(api.modelStatus('english', 'es'), (e) => e.code === 'InvalidArg')
    await assert.rejects(api.downloadModels('en', 'en'), /must differ/)
  })

  test('downloadModels informa un progreso creciente, termina y deja todo listo', async () => {
    const { port, hits } = await serve(FILES)
    api.configure({ modelsDir: tempDir('download'), manifestPath: writeManifest(port, FILES) })
    const progress = []
    api.onModelProgress((e) => progress.push(e))

    await api.downloadModels('en', 'es')

    for (const [id, total] of [['o', 150_000], ['t', 19]]) {
      const own = progress.filter((e) => e.model === id)
      assert.ok(own.length > 0, `${id} sin progreso`)
      assert.ok(own.every((e) => e.total === total))
      assert.ok(own.every((e, i) => i === 0 || e.downloaded >= own[i - 1].downloaded), `${id}: no retrocede`)
      assert.equal(own.at(-1).downloaded, total)
    }
    assert.ok((await api.modelStatus('en', 'es')).every((m) => m.state === 'ready'))

    // Con todo listo no hay red ni eventos nuevos.
    const [requests, events] = [Object.values(hits).reduce((a, b) => a + b, 0), progress.length]
    await api.downloadModels('en', 'es')
    assert.equal(Object.values(hits).reduce((a, b) => a + b, 0), requests)
    assert.equal(progress.length, events)
  })

  test('el progreso llega aunque no haya ninguna traducción en marcha', async () => {
    const { port } = await serve(FILES)
    api.configure({ modelsDir: tempDir('idle'), manifestPath: writeManifest(port, FILES) })
    const progress = []
    api.onModelProgress((e) => progress.push(e))
    await api.downloadModels('en', 'es') // sin startRegionTranslation
    assert.ok(progress.length > 0)
  })

  test('un fallo de descarga rechaza la promesa y deja el modelo ausente', async () => {
    const { port } = await serve({ 'b.bin': FILES['b.bin'], 'c.bin': FILES['c.bin'] }) // falta a.bin
    api.configure({ modelsDir: tempDir('fail'), manifestPath: writeManifest(port, FILES) })
    await assert.rejects(api.downloadModels('en', 'es'), /could not download `a.bin`/)
    assert.equal((await api.modelStatus('en', 'es'))[0].state, 'missing')
  })

  test('descargar no bloquea el hilo de JS', async () => {
    const { port } = await serve(FILES, { slow: true })
    api.configure({ modelsDir: tempDir('nonblock'), manifestPath: writeManifest(port, FILES) })

    const started = performance.now()
    const download = api.downloadModels('en', 'es')
    assert.ok(performance.now() - started < 100, 'la llamada retorna sin esperar a la descarga')

    let last = performance.now()
    let worstGap = 0
    const timer = setInterval(() => {
      const now = performance.now()
      worstGap = Math.max(worstGap, now - last)
      last = now
    }, 10)
    await download
    clearInterval(timer)
    assert.ok(worstGap < 100, `mayor hueco del bucle de eventos: ${worstGap.toFixed(1)} ms`)
  })

  test('configure durante una descarga la cancela', async () => {
    const { port } = await serve(FILES, { slow: true })
    api.configure({ modelsDir: tempDir('cancel'), manifestPath: writeManifest(port, FILES) })
    const progress = []
    api.onModelProgress((e) => progress.push(e))
    const download = api.downloadModels('en', 'es')
    assert.ok(await waitFor(() => progress.some((e) => e.downloaded > 0)))
    api.configure({ modelsDir: tempDir('cancel2') })
    await assert.rejects(download, /cancelled/)
  })
})
