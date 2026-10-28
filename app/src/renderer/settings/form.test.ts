import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import { applyPatch, defaultSettings } from '../../shared/settings.ts'
import {
  applyProgress,
  checkPatch,
  describeError,
  FONT_CHOICES,
  formatBytes,
  languageError,
  changeSource,
  languageName,
  overallPercent,
  patchForSubtitles,
  sourceLanguages,
  subtitleOptions,
  subtitlesOf,
  summarize,
  targetLanguages,
} from './form.ts'

const catalog: ModelCatalog = {
  ocrLanguages: ['en', 'es', 'ja', 'fr'],
  sttLanguages: ['en', 'es', 'ja'],
  pairs: [
    { from: 'en', to: 'es' },
    { from: 'es', to: 'en' },
  ],
}

const status = (id: string, state: ModelStatusInfo['state'], size: number): ModelStatusInfo => ({ id, state, size })

describe('idiomas', () => {
  test('el origen ofrece los idiomas que el modo sabe leer, tengan o no pares de traducción', () => {
    assert.deepEqual(sourceLanguages(catalog, 'text'), ['en', 'es', 'fr', 'ja'])
    assert.deepEqual(sourceLanguages(catalog, 'audio'), ['en', 'es', 'ja'])
    assert.deepEqual(sourceLanguages(catalog, 'auto'), ['en', 'es', 'ja'], 'en automático hacen falta OCR y voz')
    assert.deepEqual(sourceLanguages({ ocrLanguages: [], sttLanguages: [], pairs: [{ from: 'en', to: 'es' }] }), [], 'sin reconocimiento no se ofrece')
  })

  test('el destino depende del origen', () => {
    assert.deepEqual(targetLanguages(catalog, 'en'), ['es'])
    assert.deepEqual(targetLanguages(catalog, 'es'), ['en'])
    assert.deepEqual(targetLanguages(catalog, 'ja'), [])
  })

  test('languageError rechaza idiomas iguales y pares sin modelos', () => {
    assert.equal(languageError(catalog, 'en', ['es']), null)
    assert.equal(languageError(catalog, 'en', []), null, 'sin destinos no hay nada que traducir')
    assert.match(languageError(catalog, 'en', ['en']) ?? '', /distintos/)
    assert.match(languageError(catalog, 'en', ['fr']) ?? '', /No hay modelos/)
    assert.match(languageError(catalog, 'en', ['es', 'fr']) ?? '', /No hay modelos/, 'basta un destino sin modelos')
  })

  test('languageName da el nombre en español y cae al código si no lo conoce', () => {
    assert.equal(languageName('en'), 'inglés')
    assert.equal(languageName('ja'), 'japonés')
    assert.equal(languageName('zz-invalido-!!'), 'zz-invalido-!!')
  })
})

describe('subtítulos: casillas ↔ ajustes', () => {
  const wide: ModelCatalog = {
    ocrLanguages: ['en', 'es', 'fr'],
    sttLanguages: ['en', 'es', 'fr'],
    pairs: [
      { from: 'en', to: 'es' },
      { from: 'en', to: 'fr' },
      { from: 'es', to: 'en' },
      { from: 'fr', to: 'en' },
    ],
  }
  const settings = (targets: string[], showOriginal: boolean, from = 'en') => ({
    ...defaultSettings(),
    from,
    targets,
    overlay: { ...defaultSettings().overlay, showOriginal },
  })

  test('las cuatro combinaciones válidas hacen el viaje de ida y vuelta', () => {
    const cases: [string[], boolean, { first: string; second: string | null }][] = [
      [[], true, { first: 'en', second: null }],
      [['es'], false, { first: 'es', second: null }],
      [['es'], true, { first: 'en', second: 'es' }],
      [['es', 'fr'], false, { first: 'es', second: 'fr' }],
    ]
    for (const [targets, showOriginal, choice] of cases) {
      const current = settings(targets, showOriginal)
      assert.deepEqual(subtitlesOf(current), choice)
      const patch = patchForSubtitles('en', choice)
      assert.deepEqual(patch.targets, targets)
      assert.equal(patch.overlay?.showOriginal, showOriginal)
      assert.ok(applyPatch(defaultSettings(), patch).ok, JSON.stringify(patch))
    }
  })

  test('elegir el origen en la casilla 2 pone el original; el orden en pantalla sigue siendo original primero', () => {
    const patch = patchForSubtitles('en', { first: 'es', second: 'en' })
    assert.deepEqual(patch.targets, ['es'])
    assert.equal(patch.overlay?.showOriginal, true)
  })

  test('cada casilla ofrece el original y los destinos, sin el idioma de la otra', () => {
    assert.deepEqual(subtitleOptions(wide, 'en', null), ['en', 'es', 'fr'])
    assert.deepEqual(subtitleOptions(wide, 'en', 'es'), ['en', 'fr'])
    assert.deepEqual(subtitleOptions(wide, 'en', 'en'), ['es', 'fr'])
    assert.deepEqual(subtitleOptions(wide, 'ja', null), ['ja'], 'un origen sin pares solo ofrece el original')
  })

  test('cambiar el origen quita los destinos que ya no existen y los devuelve para avisar', () => {
    const change = changeSource(wide, settings(['es', 'fr'], false), 'fr')
    assert.deepEqual(change.patch.targets, [])
    assert.deepEqual(change.removed, ['es', 'fr'])
    assert.equal(change.patch.overlay?.showOriginal, true, 'si no queda ningún subtítulo se mantiene el original')
  })

  test('cambiar el origen conserva los destinos que siguen existiendo', () => {
    const change = changeSource(wide, settings(['en'], false, 'es'), 'fr')
    assert.deepEqual(change.patch.targets, ['en'])
    assert.deepEqual(change.removed, [])
    assert.equal(change.patch.overlay?.showOriginal, false)
  })

  test('un origen cuyo destino sería él mismo lo quita', () => {
    const change = changeSource(wide, settings(['es'], true), 'es')
    assert.deepEqual(change.removed, ['es'])
    assert.deepEqual(change.patch.targets, [])
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
    const result = checkPatch(defaultSettings(), { targets: ['fr'] }, catalog)
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
    assert.ok(checkPatch(defaultSettings(), { targets: ['fr'] }, null).ok)
  })

  test('todos los códigos de error que puede dar la validación tienen mensaje propio', () => {
    for (const code of ['invalid from', 'invalid to', 'invalid targets', 'invalid subtitles', 'invalid engines', 'invalid overlay.opacity', 'invalid shortcuts.selectRegion', 'from and to must differ']) {
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
