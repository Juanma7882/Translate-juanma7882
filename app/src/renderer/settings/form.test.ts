import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import { defaultSettings } from '../../shared/settings.ts'
import {
  applyProgress,
  checkPatch,
  describeError,
  FONT_CHOICES,
  formatBytes,
  languageError,
  languageName,
  overallPercent,
  pickPair,
  sourceLanguages,
  summarize,
  targetLanguages,
} from './form.ts'

const catalog: ModelCatalog = {
  ocrLanguages: ['en', 'es', 'ja', 'fr'],
  pairs: [
    { from: 'en', to: 'es' },
    { from: 'es', to: 'en' },
  ],
}

const status = (id: string, state: ModelStatusInfo['state'], size: number): ModelStatusInfo => ({ id, state, size })

describe('idiomas', () => {
  test('el origen solo ofrece idiomas con OCR y con algún par de traducción', () => {
    assert.deepEqual(sourceLanguages(catalog), ['en', 'es'], 'ja y fr tienen OCR pero ningún par')
    assert.deepEqual(sourceLanguages({ ocrLanguages: [], pairs: [{ from: 'en', to: 'es' }] }), [], 'sin OCR no se ofrece')
    assert.deepEqual(sourceLanguages({ ocrLanguages: ['en'], pairs: [] }), [])
  })

  test('el destino depende del origen', () => {
    assert.deepEqual(targetLanguages(catalog, 'en'), ['es'])
    assert.deepEqual(targetLanguages(catalog, 'es'), ['en'])
    assert.deepEqual(targetLanguages(catalog, 'ja'), [])
  })

  test('pickPair conserva un par válido y corrige uno que no lo es', () => {
    assert.deepEqual(pickPair(catalog, 'en', 'es'), { from: 'en', to: 'es' })
    assert.deepEqual(pickPair(catalog, 'es', 'es'), { from: 'es', to: 'en' }, 'el destino se ajusta al origen nuevo')
    assert.deepEqual(pickPair(catalog, 'ja', 'es'), { from: 'en', to: 'es' }, 'un origen sin pares pasa al primero disponible')
    assert.equal(pickPair({ ocrLanguages: [], pairs: [] }, 'en', 'es'), null)
  })

  test('languageError rechaza idiomas iguales y pares sin modelos', () => {
    assert.equal(languageError(catalog, 'en', 'es'), null)
    assert.match(languageError(catalog, 'en', 'en') ?? '', /distintos/)
    assert.match(languageError(catalog, 'en', 'fr') ?? '', /No hay modelos/)
  })

  test('languageName da el nombre en español y cae al código si no lo conoce', () => {
    assert.equal(languageName('en'), 'inglés')
    assert.equal(languageName('ja'), 'japonés')
    assert.equal(languageName('zz-invalido-!!'), 'zz-invalido-!!')
  })
})

describe('checkPatch', () => {
  test('acepta un cambio válido y devuelve los ajustes resultantes', () => {
    const result = checkPatch(defaultSettings(), { overlay: { opacity: 0.5 } }, catalog)
    assert.ok(result.ok)
    if (result.ok) assert.equal(result.settings.overlay.opacity, 0.5)
  })

  test('rechaza el mismo idioma en origen y destino con un mensaje claro', () => {
    const result = checkPatch(defaultSettings(), { from: 'es' }, catalog)
    assert.deepEqual(result, { ok: false, errors: ['Elige idiomas de origen y destino distintos.'] })
  })

  test('rechaza un par que no está en el catálogo aunque sean idiomas distintos', () => {
    const result = checkPatch(defaultSettings(), { to: 'fr' }, catalog)
    assert.ok(!result.ok)
    if (!result.ok) assert.match(result.errors[0] ?? '', /No hay modelos/)
  })

  test('traduce los errores de campo a mensajes en español, sin repetirlos', () => {
    const result = checkPatch(defaultSettings(), { overlay: { opacity: 9, fontSize: 1 } }, catalog)
    assert.ok(!result.ok)
    if (!result.ok) {
      assert.deepEqual([...result.errors].sort(), ['El tamaño de fuente debe estar entre 10 y 96 píxeles.', 'La opacidad debe estar entre 0,1 y 1.'].sort())
    }
  })

  test('sin catálogo todavía solo se aplican las reglas de los ajustes', () => {
    assert.ok(checkPatch(defaultSettings(), { to: 'fr' }, null).ok)
  })

  test('todos los códigos de error que puede dar la validación tienen mensaje propio', () => {
    for (const code of ['invalid from', 'invalid to', 'invalid engines', 'invalid overlay.opacity', 'invalid shortcuts.selectRegion', 'from and to must differ']) {
      assert.notEqual(describeError(code), 'Hay un valor no válido.', code)
    }
    assert.equal(describeError('invalid algo-nuevo'), 'Hay un valor no válido.')
  })

  test('todas las fuentes ofrecidas son válidas para los ajustes', () => {
    for (const { value } of FONT_CHOICES) assert.ok(checkPatch(defaultSettings(), { overlay: { fontFamily: value } }, null).ok, value)
  })
})

describe('modelos', () => {
  test('formatBytes usa la coma decimal y la unidad adecuada', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(999), '999 B')
    assert.equal(formatBytes(74_947), '74,9 KB')
    assert.equal(formatBytes(31_114_837), '31,1 MB')
    assert.equal(formatBytes(115_264_992), '115,3 MB')
    assert.equal(formatBytes(1_500_000_000), '1,5 GB')
  })

  test('summarize distingue lo que falta, lo que se está descargando y cuándo está todo listo', () => {
    assert.deepEqual(summarize([status('o', 'ready', 10), status('t', 'ready', 20)]), { missing: [], allReady: true, anyDownloading: false, missingBytes: 0 })
    const partial = summarize([status('o', 'ready', 10), status('t', 'missing', 20)])
    assert.deepEqual([partial.allReady, partial.missingBytes, partial.missing.map((m) => m.id)], [false, 20, ['t']])
    assert.equal(summarize([status('o', 'downloading', 10)]).anyDownloading, true)
    assert.equal(summarize([]).allReady, false, 'sin información no se da por listo')
  })

  test('el progreso por modelo no retrocede y recuerda el total', () => {
    let progress = applyProgress({}, { model: 'o', downloaded: 50, total: 100 })
    progress = applyProgress(progress, { model: 'o', downloaded: 30, total: null })
    assert.deepEqual(progress['o'], { downloaded: 50, total: 100 })
    progress = applyProgress(progress, { model: 't', downloaded: 5, total: 10 })
    assert.deepEqual(Object.keys(progress).sort(), ['o', 't'])
  })

  test('el avance global suma lo descargado de lo que falta, entre 0 y 100', () => {
    const missing = [status('o', 'missing', 100), status('t', 'missing', 300)]
    assert.equal(overallPercent({}, missing), 0)
    assert.equal(overallPercent({ o: { downloaded: 100, total: 100 } }, missing), 25)
    assert.equal(overallPercent({ o: { downloaded: 100, total: 100 }, t: { downloaded: 150, total: 300 } }, missing), 62)
    assert.equal(overallPercent({ o: { downloaded: 100, total: 100 }, t: { downloaded: 300, total: 300 } }, missing), 100)
    assert.equal(overallPercent({ o: { downloaded: 9_999, total: 100 } }, missing), 25, 'un exceso no pasa del tamaño del modelo')
    assert.equal(overallPercent({}, []), 100, 'nada que descargar es 100 %')
  })
})
