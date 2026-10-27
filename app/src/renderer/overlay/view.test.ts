import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { viewFor } from './view.ts'

describe('viewFor', () => {
  test('una traducción final muestra original (pequeño) y traducción', () => {
    assert.deepEqual(viewFor({ original: 'Hello', translated: 'Hola', final: true }, { showOriginal: true }), {
      original: 'Hello',
      main: 'Hola',
      provisional: false,
    })
  })

  test('sin mostrar el original, esa línea queda vacía', () => {
    assert.equal(viewFor({ original: 'Hello', translated: 'Hola', final: true }, { showOriginal: false }).original, '')
  })

  test('un parcial sin traducir muestra su texto como línea principal y como provisional', () => {
    assert.deepEqual(viewFor({ original: 'good morn', translated: null, final: false }, { showOriginal: true }), {
      original: '',
      main: 'good morn',
      provisional: true,
    })
  })

  test('un final cuya traducción falló (null o vacía) muestra el original, no una línea en blanco', () => {
    for (const translated of [null, '', '   ']) {
      const view = viewFor({ original: 'hello', translated, final: true }, { showOriginal: true })
      assert.equal(view.main, 'hello')
      assert.equal(view.original, '', 'no se repite el mismo texto en dos líneas')
      assert.equal(view.provisional, false)
    }
  })

  test('el final siguiente reemplaza al provisional: el estilo depende solo de `final`', () => {
    assert.equal(viewFor({ original: 'a', translated: 'b', final: false }, { showOriginal: true }).provisional, true)
    assert.equal(viewFor({ original: 'a', translated: 'b', final: true }, { showOriginal: true }).provisional, false)
  })
})
