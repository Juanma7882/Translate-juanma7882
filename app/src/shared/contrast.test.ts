import assert from 'node:assert/strict'
import { test } from 'node:test'

import { contrastRatio, hasEnoughContrast, isHexColor, luminance, MIN_CONTRAST, parseHex } from './contrast.ts'

test('parseHex lee los tres canales', () => {
  assert.deepEqual(parseHex('#ff8000'), [255, 128, 0])
})

test('isHexColor solo acepta #rrggbb', () => {
  assert.equal(isHexColor('#a1B2c3'), true)
  for (const bad of ['a1b2c3', '#abc', '#12345g', '', null, 7, '#1234567']) assert.equal(isHexColor(bad), false, String(bad))
})

test('la luminancia de negro y blanco son los extremos', () => {
  assert.equal(luminance('#000000'), 0)
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9)
})

test('negro sobre blanco es 21:1 y el contraste es simétrico', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-6)
  assert.equal(contrastRatio('#123456', '#fedcba'), contrastRatio('#fedcba', '#123456'))
  assert.equal(contrastRatio('#777777', '#777777'), 1)
})

test('valores conocidos de WCAG: gris #767676 sobre blanco pasa AA y #777777 no', () => {
  assert.ok(contrastRatio('#767676', '#ffffff') >= MIN_CONTRAST)
  assert.ok(contrastRatio('#777777', '#ffffff') < MIN_CONTRAST)
  assert.equal(hasEnoughContrast('#767676', '#ffffff'), true)
  assert.equal(hasEnoughContrast('#cccccc', '#ffffff'), false)
})

test('los colores por defecto del overlay tienen contraste de sobra', () => {
  assert.ok(contrastRatio('#ffffff', '#0c0c10') > 15)
})
