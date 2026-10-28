import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { linesPerTrack, overlayHeight, trackPlan } from './overlay-layout.ts'

describe('trackPlan', () => {
  test('sin destinos el original es el único subtítulo y es principal', () => {
    assert.deepEqual(trackPlan([], true), { primary: 1, secondary: false })
  })
  test('con una traducción y el original, el original es secundario', () => {
    assert.deepEqual(trackPlan(['es'], true), { primary: 1, secondary: true })
  })
  test('con dos traducciones y sin original, las dos son principales', () => {
    assert.deepEqual(trackPlan(['es', 'fr'], false), { primary: 2, secondary: false })
  })
})

describe('overlayHeight', () => {
  test('crece con las líneas y con el número de subtítulos', () => {
    const one = overlayHeight(28, 2, { primary: 1, secondary: false })
    const two = overlayHeight(28, 2, { primary: 2, secondary: false })
    const withOriginal = overlayHeight(28, 2, { primary: 1, secondary: true })
    assert.ok(two > one && withOriginal > one)
    assert.ok(overlayHeight(28, 3, { primary: 1, secondary: false }) > one)
  })
})

describe('linesPerTrack', () => {
  test('con la fuente por defecto, dos subtítulos de dos líneas caben en 1080 px sin reducir nada', () => {
    for (const plan of [trackPlan(['es'], true), trackPlan(['es', 'fr'], false)]) {
      assert.equal(linesPerTrack(28, 2, plan, 1080), 2)
    }
  })

  test('el peor caso (96 px, 6 líneas, dos subtítulos, 768 px) reduce las líneas y nunca baja de una', () => {
    const plan = trackPlan(['es', 'fr'], false)
    const lines = linesPerTrack(96, 6, plan, 768)
    assert.ok(lines >= 1 && lines < 6, String(lines))
    assert.ok(overlayHeight(96, lines, plan) <= 768 * 0.45 || lines === 1)
  })

  test('aunque ni una línea quepa, queda una por subtítulo', () => {
    assert.equal(linesPerTrack(96, 6, trackPlan(['es', 'fr'], false), 300), 1)
  })

  test('un solo subtítulo con una pantalla normal no se reduce', () => {
    assert.equal(linesPerTrack(28, 6, trackPlan([], true), 1080), 6)
  })

  test('el resultado es monótono: más pantalla nunca da menos líneas', () => {
    const plan = trackPlan(['es', 'fr'], false)
    let last = 0
    for (const height of [400, 600, 768, 900, 1080, 1440]) {
      const lines = linesPerTrack(48, 6, plan, height)
      assert.ok(lines >= last, `${height}: ${lines} < ${last}`)
      last = lines
    }
  })
})
