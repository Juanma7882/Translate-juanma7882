import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { defaultSettings } from '../../shared/settings.ts'
import { viewFor } from '../overlay/view.ts'
import { previewLines, previewText, sampleFor } from './preview.ts'

describe('vista previa de subtítulos', () => {
  test('hay una frase de muestra por idioma y un texto genérico para los demás', () => {
    assert.match(sampleFor('es'), /Hola/)
    assert.match(sampleFor('en-US'), /Hello/, 'una variante regional usa el idioma principal')
    assert.equal(sampleFor('ja'), 'Aa Bb Cc. Preview.')
  })

  test('el texto de muestra tiene el original y una traducción por destino, en orden', () => {
    const settings = { ...defaultSettings(), from: 'en', targets: ['fr', 'es'] }
    const text = previewText(settings)
    assert.equal(text.lang, 'en')
    assert.deepEqual(
      text.translations.map((t) => t.lang),
      ['fr', 'es'],
    )
  })

  test('con los ajustes por defecto la vista previa tiene dos líneas: original y traducción', () => {
    const settings = defaultSettings()
    const view = viewFor(previewText(settings), settings.overlay)
    assert.deepEqual(
      view.lines.map((l) => l.lang),
      ['en', 'es'],
    )
  })

  test('sin el original, solo la traducción', () => {
    const settings = { ...defaultSettings(), overlay: { ...defaultSettings().overlay, showOriginal: false } }
    const view = viewFor(previewText(settings), settings.overlay)
    assert.deepEqual(
      view.lines.map((l) => l.lang),
      ['es'],
    )
  })

  test('el peor caso reduce las líneas de la vista previa igual que el overlay', () => {
    const settings = { ...defaultSettings(), targets: ['es', 'fr'], overlay: { ...defaultSettings().overlay, showOriginal: false, fontSize: 96, maxLines: 6 } }
    assert.ok(previewLines(settings, 768) < 6)
    assert.equal(previewLines(defaultSettings(), 1080), defaultSettings().overlay.maxLines)
  })
})
