import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { OverlayText } from '../../shared/ipc.ts'
import { viewFor } from './view.ts'

const text = (over: Partial<OverlayText> = {}): OverlayText => ({
  original: 'Hello',
  lang: 'en',
  translations: [{ lang: 'es', text: 'Hola' }],
  final: true,
  ...over,
})

describe('viewFor', () => {
  test('original (pequeño) y traducción, en ese orden y con su idioma', () => {
    assert.deepEqual(viewFor(text(), { showOriginal: true }), {
      lines: [
        { lang: 'en', text: 'Hello', kind: 'original', secondary: true },
        { lang: 'es', text: 'Hola', kind: 'translation', secondary: false },
      ],
      provisional: false,
      labeled: true,
    })
  })

  test('sin mostrar el original, solo queda la traducción y no se rotula', () => {
    const view = viewFor(text(), { showOriginal: false })
    assert.deepEqual(
      view.lines.map((l) => l.lang),
      ['es'],
    )
    assert.equal(view.labeled, false)
  })

  test('dos traducciones sin original: dos líneas principales en el orden de los destinos', () => {
    const view = viewFor(
      text({
        translations: [
          { lang: 'fr', text: 'Bonjour' },
          { lang: 'es', text: 'Hola' },
        ],
      }),
      { showOriginal: false },
    )
    assert.deepEqual(
      view.lines.map((l) => [l.lang, l.secondary]),
      [
        ['fr', false],
        ['es', false],
      ],
    )
    assert.equal(view.labeled, true)
  })

  test('sin traducciones, el original es la única línea y es principal aunque se pida ocultarlo', () => {
    for (const showOriginal of [true, false]) {
      const view = viewFor(text({ translations: [] }), { showOriginal })
      assert.deepEqual(view.lines, [{ lang: 'en', text: 'Hello', kind: 'original', secondary: false }])
      assert.equal(view.labeled, false)
    }
  })

  test('un parcial sin traducir se muestra como provisional', () => {
    const view = viewFor(text({ original: 'good morn', translations: [], final: false }), { showOriginal: false })
    assert.deepEqual(
      view.lines.map((l) => l.text),
      ['good morn'],
    )
    assert.equal(view.provisional, true)
  })

  test('una traducción en blanco se ignora y no deja una línea vacía', () => {
    const view = viewFor(
      text({
        translations: [
          { lang: 'es', text: '   ' },
          { lang: 'fr', text: 'Bonjour' },
        ],
      }),
      { showOriginal: true },
    )
    assert.deepEqual(
      view.lines.map((l) => l.lang),
      ['en', 'fr'],
    )
  })

  test('el final siguiente reemplaza al provisional: el estilo depende solo de `final`', () => {
    assert.equal(viewFor(text({ final: false }), { showOriginal: true }).provisional, true)
    assert.equal(viewFor(text({ final: true }), { showOriginal: true }).provisional, false)
  })
})
