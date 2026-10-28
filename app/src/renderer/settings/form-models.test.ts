import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { InstalledModelInfo, ModelInventory } from 'tr-bindings'

import {
  contrastInfo,
  deleteMessage,
  describeError,
  dirMessage,
  fieldOf,
  formatRatio,
  installedRows,
  modelTitle,
  partialBytesOf,
  stateLabel,
  tabForKey,
  toIssues,
} from './form.ts'

const model = (id: string, kind: string, keys: string[], disk: number, partial = 0, state: InstalledModelInfo['state'] = 'ready'): InstalledModelInfo => ({
  id,
  roles: keys.map((key) => ({ kind, key })),
  state,
  size: disk + partial,
  diskBytes: disk,
  partialBytes: partial,
})

const inventory: ModelInventory = {
  dir: '/modelos',
  totalBytes: 0,
  models: [
    model('mt-opus-en-es', 'translate', ['en-es'], 100),
    model('ocr-ppocrv6-small', 'ocr', ['en', 'es', 'fr'], 300),
    model('mt-opus-en-fr', 'translate', ['en-fr'], 0),
    model('stt-whisper-base', 'stt', ['en'], 0, 50, 'missing'),
  ],
}

describe('errores junto al campo', () => {
  test('cada código conocido apunta a su control', () => {
    assert.equal(fieldOf('invalid overlay.fontSize'), 'fontSize')
    assert.equal(fieldOf('invalid overlay.contrast'), 'textColor')
    assert.equal(fieldOf('invalid performance.beamWidth'), 'perf-beam')
    assert.equal(fieldOf('invalid modelsDir: not-writable'), 'models-dir')
    assert.equal(fieldOf('from and to must differ'), null)
  })

  test('toIssues traduce, asigna campo y quita repetidos', () => {
    const issues = toIssues(['invalid overlay.fontSize', 'invalid overlay.fontSize', 'from and to must differ'])
    assert.equal(issues.length, 2)
    assert.equal(issues[0]?.field, 'fontSize')
    assert.match(issues[0]?.message ?? '', /entre 10 y 96/)
    assert.equal(issues[1]?.field, null)
  })

  test('los motivos de carpeta no válida salen en español', () => {
    for (const reason of ['not-absolute', 'parent-references', 'root', 'not-a-folder', 'not-writable', 'running', 'empty']) {
      assert.notEqual(dirMessage(reason), dirMessage('desconocido'), reason)
      assert.equal(describeError(`invalid modelsDir: ${reason}`), dirMessage(reason))
    }
  })

  test('los avisos de importación nombran el problema sin valores', () => {
    assert.match(describeError('modelsDir is not imported'), /no se importan/)
    assert.match(describeError('unknown setting hack'), /desconocido/)
    assert.match(describeError('import is not valid JSON'), /JSON/)
    assert.match(describeError('invalid overlay.contrast'), /4,5 a 1/)
  })

  test('los motivos de borrado fallido se explican', () => {
    for (const reason of ['running', 'downloading', 'unknown', 'failed'] as const) assert.ok(deleteMessage(reason).length > 10, reason)
  })
})

describe('contraste', () => {
  test('el formato usa coma decimal', () => {
    assert.equal(formatRatio(7.25), '7,3 a 1')
    assert.equal(formatRatio(21), '21,0 a 1')
  })

  test('informa si el par es legible', () => {
    assert.equal(contrastInfo('#ffffff', '#0c0c10').ok, true)
    const low = contrastInfo('#cccccc', '#ffffff')
    assert.equal(low.ok, false)
    assert.match(low.text, /demasiado bajo/)
  })
})

describe('modelos instalados', () => {
  test('los títulos describen para qué sirve cada modelo', () => {
    assert.equal(modelTitle(inventory.models[0]!), 'Traducción inglés → español')
    assert.equal(modelTitle(inventory.models[1]!), 'Reconocimiento de texto (3 idiomas)')
    assert.equal(modelTitle(inventory.models[3]!), 'Reconocimiento de voz (inglés)')
    assert.equal(modelTitle({ id: 'raro', roles: [] }), 'raro')
  })

  test('solo se listan los que ocupan espacio, del mayor al menor, con los parciales', () => {
    const rows = installedRows(inventory)
    assert.deepEqual(
      rows.map((r) => [r.id, r.bytes, r.partialBytes]),
      [
        ['ocr-ppocrv6-small', 300, 0],
        ['mt-opus-en-es', 100, 0],
        ['stt-whisper-base', 50, 50],
      ],
    )
  })

  test('los parciales de un conjunto de modelos se suman', () => {
    assert.equal(partialBytesOf(inventory, ['stt-whisper-base', 'mt-opus-en-es']), 50)
    assert.equal(partialBytesOf(inventory, ['mt-opus-en-es']), 0)
    assert.equal(partialBytesOf(null, ['x']), 0)
  })

  test('estados legibles', () => {
    assert.deepEqual([stateLabel('ready'), stateLabel('downloading'), stateLabel('missing')], ['listo', 'descargando', 'falta'])
  })
})

describe('pestañas', () => {
  const tabs = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ]

  test('las flechas dan la vuelta', () => {
    assert.equal(tabForKey(tabs, 'a', 'ArrowRight'), 'b')
    assert.equal(tabForKey(tabs, 'c', 'ArrowRight'), 'a')
    assert.equal(tabForKey(tabs, 'a', 'ArrowLeft'), 'c')
    assert.equal(tabForKey(tabs, 'b', 'ArrowUp'), 'a')
    assert.equal(tabForKey(tabs, 'b', 'ArrowDown'), 'c')
  })

  test('Inicio y Fin saltan a los extremos y otras teclas no navegan', () => {
    assert.equal(tabForKey(tabs, 'b', 'Home'), 'a')
    assert.equal(tabForKey(tabs, 'b', 'End'), 'c')
    assert.equal(tabForKey(tabs, 'b', 'Enter'), null)
    assert.equal(tabForKey(tabs, 'zzz', 'ArrowRight'), null)
    assert.equal(tabForKey([], 'a', 'Home'), null)
  })
})
