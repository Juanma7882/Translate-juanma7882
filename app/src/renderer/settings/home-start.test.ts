import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import {
  firstRunSteps,
  GUIDE_DONE_KEY,
  installedPairs,
  modeSentence,
  readFlag,
  regionSummary,
  writeFlag,
} from './home.ts'
import type { FlagStore, FirstRunInput } from './home.ts'

const fresh: FirstRunInput = { mode: 'text', hasRegion: false, modelsReady: false, hasEverStarted: false }

describe('firstRunSteps', () => {
  test('instalación nueva: tres pasos pendientes y se destaca el primero', () => {
    const run = firstRunSteps(fresh)
    assert.deepEqual(
      run.steps.map((s) => [s.id, s.done]),
      [
        ['language', false],
        ['region', false],
        ['start', false],
      ],
    )
    assert.equal(run.current, 'language')
    assert.equal(run.complete, false)
  })

  test('al descargar el idioma se destaca el siguiente', () => {
    const run = firstRunSteps({ ...fresh, modelsReady: true })
    assert.equal(run.steps[0]?.done, true)
    assert.equal(run.current, 'region')
  })

  test('orden flexible: con la región elegida el idioma sigue siendo el primero pendiente', () => {
    const run = firstRunSteps({ ...fresh, hasRegion: true })
    assert.equal(run.steps.find((s) => s.id === 'region')?.done, true)
    assert.equal(run.current, 'language')
  })

  test('solo audio: dos pasos, sin región', () => {
    const run = firstRunSteps({ ...fresh, mode: 'audio' })
    assert.deepEqual(
      run.steps.map((s) => s.id),
      ['language', 'start'],
    )
    assert.match(run.steps[0]?.label ?? '', /audio/)
  })

  test('solo audio: una región guardada no cuenta ni hace falta', () => {
    const run = firstRunSteps({ mode: 'audio', hasRegion: true, modelsReady: true, hasEverStarted: false })
    assert.equal(run.current, 'start')
  })

  test('todo hecho: completa y sin paso destacado', () => {
    const run = firstRunSteps({ mode: 'auto', hasRegion: true, modelsReady: true, hasEverStarted: true })
    assert.equal(run.complete, true)
    assert.equal(run.current, null)
    assert.ok(run.steps.every((s) => s.done))
  })

  test('cada paso tiene texto propio (el estado no depende solo del color)', () => {
    for (const mode of ['auto', 'text', 'audio'] as const) {
      for (const step of firstRunSteps({ ...fresh, mode }).steps) assert.ok(step.label.length > 0)
    }
  })
})

describe('regionSummary', () => {
  const region = { x: 100, y: 200, width: 640, height: 120, monitor: 0 }

  test('sin región: dice que falta y ofrece elegirla', () => {
    const s = regionSummary(null, 'text')
    assert.match(s.text, /Falta/)
    assert.equal(s.canChange, true)
    assert.equal(s.buttonLabel, 'Elegir región')
  })

  test('con región: tamaño, posición y «Cambiar región»', () => {
    const s = regionSummary(region, 'auto')
    assert.match(s.text, /640 × 120 px/)
    assert.match(s.text, /\(100, 200\)/)
    assert.equal(s.buttonLabel, 'Cambiar región')
    assert.equal(s.canChange, true)
  })

  test('otra pantalla se indica; la principal no', () => {
    assert.doesNotMatch(regionSummary(region, 'text').text, /pantalla/)
    assert.match(regionSummary({ ...region, monitor: 1 }, 'text').text, /pantalla 2/)
  })

  test('solo audio: no necesita región aunque haya una guardada', () => {
    for (const r of [null, region]) {
      const s = regionSummary(r, 'audio')
      assert.equal(s.canChange, false)
      assert.match(s.text, /no necesita región/)
    }
  })
})

describe('modeSentence', () => {
  test('una frase distinta y no vacía por modo', () => {
    const sentences = (['auto', 'text', 'audio'] as const).map(modeSentence)
    assert.ok(sentences.every((s) => s.length > 0))
    assert.equal(new Set(sentences).size, 3)
    assert.match(modeSentence('auto'), /si no hay texto/)
  })
})

describe('installedPairs', () => {
  const catalog = {
    pairs: [
      { from: 'es', to: 'en' },
      { from: 'en', to: 'es' },
      { from: 'fr', to: 'es' },
      { from: 'de', to: 'en' },
    ],
  } as unknown as ModelCatalog
  const st = (state: ModelStatusInfo['state']): ModelStatusInfo => ({ id: 'm', state, size: 1 }) as unknown as ModelStatusInfo

  test('solo los pares con todos los modelos listos, ordenados', () => {
    const pairs = installedPairs(catalog, {
      'es>en': [st('ready'), st('ready')],
      'en>es': [st('ready')],
      'fr>es': [st('ready'), st('missing')],
      'de>en': [],
    })
    assert.deepEqual(pairs, [
      { from: 'en', to: 'es' },
      { from: 'es', to: 'en' },
    ])
  })

  test('sin estados todavía o sin catálogo: ninguno', () => {
    assert.deepEqual(installedPairs(catalog, {}), [])
    assert.deepEqual(installedPairs(null, { 'es>en': [st('ready')] }), [])
  })

  test('descargando no cuenta como instalado', () => {
    assert.deepEqual(installedPairs(catalog, { 'es>en': [st('downloading')] }), [])
  })
})

describe('marcas de la guía', () => {
  const memory = (): FlagStore & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  }
  const broken: FlagStore = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }

  test('almacén vacío: no marcada; tras escribir, marcada', () => {
    const store = memory()
    assert.equal(readFlag(store, GUIDE_DONE_KEY), false)
    writeFlag(store, GUIDE_DONE_KEY)
    assert.equal(readFlag(store, GUIDE_DONE_KEY), true)
  })

  test('un almacén que lanza excepción no rompe nada', () => {
    assert.equal(readFlag(broken, GUIDE_DONE_KEY), false)
    assert.doesNotThrow(() => writeFlag(broken, GUIDE_DONE_KEY))
  })

  test('sin almacén (null) tampoco', () => {
    assert.equal(readFlag(null, GUIDE_DONE_KEY), false)
    assert.doesNotThrow(() => writeFlag(null, GUIDE_DONE_KEY))
  })
})
