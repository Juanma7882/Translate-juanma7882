'use strict'

// Gestión de modelos desde JS: inventario, borrado seguro, cancelar y reanudar descargas contra un
// servidor HTTP local con Range y fallos, validación de carpeta y opciones de rendimiento.

const { test, afterEach, describe, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const api = require('../api.js')

const REGION = { x: 0, y: 0, width: 32, height: 32 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const tempDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `tr-mgmt-${tag}-`))

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

const BIG = Buffer.from(Array.from({ length: 150_000 }, (_, i) => i % 251))
const FILES = { 'a.bin': BIG, 'b.bin': Buffer.from('model-b'), 'c.bin': Buffer.from('model-c-data') }

/**
 * Servidor de modelos. Opciones: `ranges` (admite Range; por defecto sí), `chunk`/`delay` (envío
 * lento), `cutFirstAt` (la primera petición de `a.bin` se corta tras esos bytes) y `rejectRange`
 * (responde 416 a cualquier Range).
 */
function serve(options = {}) {
  const { ranges = true, chunk = 10_000, delay = 0, rejectRange = false } = options
  const log = []
  let cutFirstAt = options.cutFirstAt ?? null
  const server = http.createServer((req, res) => {
    const name = req.url.slice(1)
    const body = FILES[name]
    if (!body) return res.writeHead(404).end()
    const range = req.headers.range ?? null
    if (name === 'a.bin') log.push(range)
    if (range && rejectRange) return res.writeHead(416).end()
    const start = range && ranges ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0) : 0
    const rest = body.subarray(start)
    if (start > 0) res.writeHead(206, { 'content-length': rest.length, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` })
    else res.writeHead(200, { 'content-length': rest.length })
    let limit = rest.length
    if (name === 'a.bin' && start === 0 && cutFirstAt !== null) {
      limit = cutFirstAt
      cutFirstAt = null
    }
    let offset = 0
    const pump = () => {
      if (offset >= limit) return limit < rest.length ? res.destroy() : res.end()
      res.write(rest.subarray(offset, Math.min(offset + chunk, limit)))
      offset += chunk
      if (delay > 0) setTimeout(pump, delay)
      else setImmediate(pump)
    }
    pump()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      toClean.push(() => {
        server.close()
        server.closeAllConnections()
      })
      resolve({ port: server.address().port, log })
    }),
  )
}

/** Manifiesto con `o` (OCR, un archivo grande) y `t` (traducción, dos pequeños). */
function writeManifest(port) {
  const entry = (name) => `{"name":"${name}","url":"http://127.0.0.1:${port}/${name}","sha256":"${sha256(FILES[name])}","size":${FILES[name].length}}`
  const json = `{"version":1,"models":{"o":{"files":[${entry('a.bin')}]},"t":{"files":[${entry('b.bin')},${entry('c.bin')}]}},"ocr":{"en":"o"},"translate":{"en-es":"t"}}`
  const file = path.join(tempDir('manifest'), 'models.json')
  fs.writeFileSync(file, json)
  return file
}

async function setup(tag, options) {
  const server = await serve(options)
  const modelsDir = tempDir(tag)
  api.configure({ modelsDir, manifestPath: writeManifest(server.port) })
  return { ...server, modelsDir }
}

describe('inventario y borrado', () => {
  test('el inventario lista cada modelo con sus roles, estado y espacio en disco', async () => {
    const { modelsDir } = await setup('inventory')
    const empty = await api.modelInventory()
    assert.equal(empty.dir, modelsDir)
    assert.equal(empty.totalBytes, 0)
    assert.deepEqual(
      empty.models.map((m) => [m.id, m.state, m.size, m.diskBytes, m.partialBytes]),
      [
        ['o', 'missing', 150_000, 0, 0],
        ['t', 'missing', 19, 0, 0],
      ],
    )
    assert.deepEqual(empty.models[0].roles, [{ kind: 'ocr', key: 'en' }])
    assert.deepEqual(empty.models[1].roles, [{ kind: 'translate', key: 'en-es' }])

    await api.downloadModels('en', ['es'])
    const full = await api.modelInventory()
    assert.equal(full.totalBytes, 150_019)
    assert.deepEqual(full.models.map((m) => [m.state, m.diskBytes]), [['ready', 150_000], ['ready', 19]])
  })

  test('el manifiesto incluido se lista completo, con los pares nuevos', async () => {
    api.configure({ modelsDir: tempDir('embedded') })
    const inventory = await api.modelInventory()
    const ids = inventory.models.map((m) => m.id)
    for (const id of ['mt-opus-en-fr', 'mt-opus-fr-en', 'mt-opus-en-de', 'mt-opus-de-en', 'mt-opus-en-it', 'mt-opus-it-en', 'mt-opus-es-fr', 'mt-opus-fr-es', 'ocr-ppocrv6-small', 'stt-whisper-base']) {
      assert.ok(ids.includes(id), id)
    }
    assert.ok(inventory.totalBytes === 0)
  })

  test('borrar libera el espacio, deja el modelo ausente y no toca nada más', async () => {
    const { modelsDir } = await setup('delete')
    await api.downloadModels('en', ['es'])
    fs.mkdirSync(path.join(modelsDir, 'otro'))
    fs.writeFileSync(path.join(modelsDir, 'otro', 'mio.txt'), 'mío')
    fs.writeFileSync(path.join(modelsDir, 't', 'notas.txt'), 'notas del usuario')

    assert.equal(await api.deleteModel('o'), 150_000)
    assert.ok(!fs.existsSync(path.join(modelsDir, 'o')))
    assert.equal(await api.deleteModel('t'), 19)
    assert.deepEqual(fs.readdirSync(path.join(modelsDir, 't')), ['notas.txt'], 'los archivos ajenos se conservan')
    assert.equal(fs.readFileSync(path.join(modelsDir, 'otro', 'mio.txt'), 'utf8'), 'mío')
    const after = await api.modelInventory()
    assert.deepEqual(after.models.map((m) => m.state), ['missing', 'missing'])
    assert.equal(after.totalBytes, 0)
    assert.equal(await api.deleteModel('o'), 0, 'borrar de nuevo no falla')
  })

  test('los ids con rutas o desconocidos se rechazan sin borrar nada', async () => {
    const { modelsDir } = await setup('badid')
    await api.downloadModels('en', ['es'])
    fs.writeFileSync(path.join(modelsDir, 'fuera.txt'), 'x')
    for (const id of ['../', '..', '../o', 'o/../..', '/etc', '', 'nope', 'o/a.bin']) {
      await assert.rejects(api.deleteModel(id), (e) => e.code === 'InvalidArg', JSON.stringify(id))
    }
    assert.ok(fs.existsSync(path.join(modelsDir, 'fuera.txt')))
    assert.deepEqual((await api.modelStatus('en', ['es'])).map((m) => m.state), ['ready', 'ready'])
  })

  test('no se borra mientras haya una traducción en marcha', async () => {
    const { modelsDir } = await setup('running')
    await api.downloadModels('en', ['es'])
    api.startRegionTranslation(REGION, 'en', ['es'])
    await assert.rejects(api.deleteModel('o'), /translation is running/)
    assert.ok(fs.existsSync(path.join(modelsDir, 'o', 'a.bin')), 'el archivo sigue ahí')
    api.stop()
    assert.equal(await api.deleteModel('o'), 150_000)
  })
})

describe('cancelar, reanudar y fallos de descarga', () => {
  test('cancelar rechaza la descarga, conserva el parcial y reanudar pide solo el resto', async () => {
    const { modelsDir, log } = await setup('cancel', { delay: 25 })
    const download = api.downloadModels('en', ['es'])
    const rejected = assert.rejects(download, /cancelled/)
    const part = path.join(modelsDir, 'o', 'a.bin.part')
    assert.ok(await waitFor(() => fs.existsSync(part) && fs.statSync(part).size >= 20_000), 'empezó a descargar')
    await api.cancelModelDownload()
    await rejected

    const left = fs.statSync(part).size
    assert.ok(left > 0 && left < 150_000, `parcial a medias: ${left}`)
    assert.ok(!fs.existsSync(path.join(modelsDir, 'o', 'a.bin')))
    const inventory = await api.modelInventory()
    assert.equal(inventory.models[0].partialBytes, left)
    assert.equal(inventory.models[0].state, 'missing')

    await api.downloadModels('en', ['es'])
    assert.deepEqual(log, [null, `bytes=${left}-`])
    assert.equal(sha256(fs.readFileSync(path.join(modelsDir, 'o', 'a.bin'))), sha256(BIG))
    assert.ok(!fs.existsSync(part))
    assert.deepEqual((await api.modelStatus('en', ['es'])).map((m) => m.state), ['ready', 'ready'])
  })

  test('un corte de red deja el parcial y se reanuda desde ahí', async () => {
    const { modelsDir, log } = await setup('cut', { cutFirstAt: 60_000 })
    await assert.rejects(api.downloadModels('en', ['es']))
    assert.equal(fs.statSync(path.join(modelsDir, 'o', 'a.bin.part')).size, 60_000)
    assert.ok(!fs.existsSync(path.join(modelsDir, 'o', 'a.bin')))
    await api.downloadModels('en', ['es'])
    assert.deepEqual(log, [null, 'bytes=60000-'])
    assert.equal(sha256(fs.readFileSync(path.join(modelsDir, 'o', 'a.bin'))), sha256(BIG))
  })

  test('el progreso de una reanudación parte de lo ya descargado y no retrocede', async () => {
    await setup('progress', { cutFirstAt: 80_000 })
    await assert.rejects(api.downloadModels('en', ['es']))
    const seen = []
    const off = api.onModelProgress((e) => e.model === 'o' && seen.push(e.downloaded))
    await api.downloadModels('en', ['es'])
    off()
    assert.ok(seen.length > 0)
    assert.ok(seen.find((v) => v > 0) >= 80_000, `el primer avance incluye lo descargado: ${seen.slice(0, 3)}`)
    assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]))
    assert.equal(seen.at(-1), 150_000)
  })

  test('un servidor sin Range reinicia desde cero y termina bien', async () => {
    const { modelsDir } = await setup('norange', { ranges: false, cutFirstAt: 50_000 })
    await assert.rejects(api.downloadModels('en', ['es']))
    assert.equal(fs.statSync(path.join(modelsDir, 'o', 'a.bin.part')).size, 50_000)
    await api.downloadModels('en', ['es'])
    assert.equal(sha256(fs.readFileSync(path.join(modelsDir, 'o', 'a.bin'))), sha256(BIG))
    assert.ok(!fs.existsSync(path.join(modelsDir, 'o', 'a.bin.part')))
  })

  test('un 416 al reanudar reinicia desde cero', async () => {
    const { modelsDir, log } = await setup('416', { rejectRange: true, cutFirstAt: 50_000 })
    await assert.rejects(api.downloadModels('en', ['es']))
    await api.downloadModels('en', ['es'])
    assert.deepEqual(log, [null, 'bytes=50000-', null])
    assert.equal(sha256(fs.readFileSync(path.join(modelsDir, 'o', 'a.bin'))), sha256(BIG))
  })

  test('un parcial corrupto se descarta al fallar la huella y el siguiente intento sale bien', async () => {
    const { modelsDir } = await setup('badpart')
    fs.mkdirSync(path.join(modelsDir, 'o'))
    const bad = Buffer.from(BIG.subarray(0, 30_000))
    bad[7] ^= 0xff
    fs.writeFileSync(path.join(modelsDir, 'o', 'a.bin.part'), bad)
    await assert.rejects(api.downloadModels('en', ['es']), /corrupt/)
    assert.ok(!fs.existsSync(path.join(modelsDir, 'o', 'a.bin.part')), 'el parcial malo se elimina')
    await api.downloadModels('en', ['es'])
    assert.equal(sha256(fs.readFileSync(path.join(modelsDir, 'o', 'a.bin'))), sha256(BIG))
  })

  test('cancelar sin descargas en curso no hace daño y la siguiente descarga funciona', async () => {
    await setup('idle-cancel')
    await api.cancelModelDownload()
    await api.downloadModels('en', ['es'])
    assert.deepEqual((await api.modelStatus('en', ['es'])).map((m) => m.state), ['ready', 'ready'])
  })

  test('no se borra un modelo mientras se descarga', async () => {
    const { modelsDir } = await setup('delete-busy', { delay: 25 })
    const download = api.downloadModels('en', ['es'])
    const rejected = assert.rejects(download, /cancelled/)
    assert.ok(await waitFor(() => fs.existsSync(path.join(modelsDir, 'o', 'a.bin.part'))))
    await assert.rejects(api.deleteModel('o'), /being downloaded/)
    await api.cancelModelDownload()
    await rejected
    assert.ok((await api.deleteModel('o')) > 0, 'cancelada, el parcial sí se puede borrar')
  })
})

describe('carpeta de modelos', () => {
  test('una carpeta escribible, existente o por crear, es válida y no se crea', () => {
    const root = tempDir('dir-ok')
    assert.deepEqual(api.validateModelsDir(root), { ok: true })
    assert.deepEqual(api.validateModelsDir(path.join(root, 'a', 'b')), { ok: true })
    assert.ok(!fs.existsSync(path.join(root, 'a')))
    assert.deepEqual(fs.readdirSync(root), [], 'sin restos de la prueba de escritura')
  })

  test('las carpetas inválidas dicen por qué', () => {
    const root = tempDir('dir-bad')
    const file = path.join(root, 'archivo')
    fs.writeFileSync(file, 'x')
    const reason = (p) => api.validateModelsDir(p).reason
    assert.equal(reason('relativa/carpeta'), 'not-absolute')
    assert.equal(reason(`${root}/../x`), 'parent-references')
    assert.equal(reason(file), 'not-a-folder')
    assert.equal(reason(path.join(file, 'dentro')), 'not-a-folder')
    assert.equal(reason(path.parse(root).root), 'root')
    assert.equal(api.validateModelsDir('relativa').ok, false)
  })
})

describe('opciones de rendimiento', () => {
  test('valores en rango o ausentes se aceptan', () => {
    for (const performance of [undefined, {}, { intraThreads: 1 }, { beamWidth: 8 }, { cacheCapacity: 1 }, { intraThreads: 64, beamWidth: 1, cacheCapacity: 1_000_000 }, { ocrMaxSide: 160 }, { ocrMaxSide: 4000, lowMemory: true }, { lowMemory: false }]) {
      assert.doesNotThrow(() => api.configure({ performance }), JSON.stringify(performance))
    }
  })

  test('cacheStats devuelve solo contadores y la caché cuenta las repeticiones', async () => {
    api.configure({ frameIntervalMs: 5 })
    const empty = api.cacheStats()
    assert.deepEqual(Object.keys(empty).sort(), ['evictions', 'hitRatio', 'hits', 'inserts', 'misses'])
    for (const value of Object.values(empty)) assert.equal(typeof value, 'number')
    assert.deepEqual(empty, { hits: 0, misses: 0, inserts: 0, evictions: 0, hitRatio: 0 })

    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => events.length >= 1))
    api.stop()
    const stats = api.cacheStats()
    assert.ok(stats.misses >= 1 && stats.inserts >= 1, JSON.stringify(stats))
    assert.ok(stats.hitRatio >= 0 && stats.hitRatio <= 1)
    api.configure({})
    assert.equal(api.cacheStats().inserts, 0, 'configure crea un motor nuevo')
  })

  test('valores fuera de rango son argumentos inválidos y no cambian nada', async () => {
    api.configure({ frameIntervalMs: 5 })
    const events = []
    api.onTranslation((e) => events.push(e))
    api.startRegionTranslation(REGION, 'en', ['es'])
    assert.ok(await waitFor(() => events.length >= 1))
    const bad = [
      [{ intraThreads: 0 }, /intraThreads/],
      [{ intraThreads: 65 }, /intraThreads/],
      [{ beamWidth: 0 }, /beamWidth/],
      [{ beamWidth: 9 }, /beamWidth/],
      [{ cacheCapacity: 0 }, /cacheCapacity/],
      [{ cacheCapacity: 1_000_001 }, /cacheCapacity/],
      [{ ocrMaxSide: 159 }, /ocrMaxSide/],
      [{ ocrMaxSide: 4001 }, /ocrMaxSide/],
    ]
    for (const [performance, message] of bad) {
      assert.throws(() => api.configure({ performance }), (e) => e.code === 'InvalidArg' && message.test(e.message), JSON.stringify(performance))
    }
    const seen = events.length
    assert.ok(await waitFor(() => events.length > seen + 1), 'la sesión original sigue emitiendo')
  })
})
