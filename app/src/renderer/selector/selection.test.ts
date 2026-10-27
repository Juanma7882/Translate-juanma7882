import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MIN_SELECTION_DIP } from '../../shared/geometry.ts'
import { initialState, isDragging, normalize, reduce, visibleRect } from './selection.ts'
import type { Point, SelectionInput, SelectionState } from './selection.ts'

const p = (x: number, y: number): Point => ({ x, y })

/** Aplica una secuencia de entradas y devuelve el último estado y todos los efectos no nulos. */
function run(inputs: SelectionInput[], previous = null as SelectionState['previous']) {
  let state = initialState(previous)
  const effects: unknown[] = []
  for (const input of inputs) {
    const step = reduce(state, input)
    state = step.state
    if (step.effect) effects.push(step.effect)
  }
  return { state, effects }
}

describe('normalize', () => {
  test('da el mismo rectángulo arrastres en cualquier dirección', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 }
    for (const [a, b] of [[p(10, 20), p(40, 60)], [p(40, 60), p(10, 20)], [p(40, 20), p(10, 60)], [p(10, 60), p(40, 20)]] as const) {
      assert.deepEqual(normalize(a, b), expected)
    }
  })
})

describe('arrastre', () => {
  test('arrastrar y soltar confirma el rectángulo', () => {
    const { effects, state } = run([{ type: 'down', point: p(100, 80) }, { type: 'move', point: p(250, 150) }, { type: 'up', point: p(400, 200) }])
    assert.deepEqual(effects, [{ type: 'confirm', rect: { x: 100, y: 80, width: 300, height: 120 } }])
    assert.equal(isDragging(state), false)
  })

  test('mientras se arrastra se dibuja el rectángulo en curso, normalizado', () => {
    const { state } = run([{ type: 'down', point: p(300, 300) }, { type: 'move', point: p(100, 250) }])
    assert.deepEqual(visibleRect(state), { rect: { x: 100, y: 250, width: 200, height: 50 }, previous: false })
    assert.equal(isDragging(state), true)
  })

  test('mover sin haber pulsado, o soltar sin haber pulsado, no hace nada', () => {
    const { effects, state } = run([{ type: 'move', point: p(5, 5) }, { type: 'up', point: p(9, 9) }])
    assert.deepEqual(effects, [])
    assert.equal(isDragging(state), false)
  })

  test('un clic sin arrastre no confirma y la ventana sigue esperando', () => {
    const { effects, state } = run([{ type: 'down', point: p(50, 50) }, { type: 'up', point: p(50, 50) }])
    assert.deepEqual(effects, [])
    assert.equal(isDragging(state), false)
  })

  test('el mínimo es inclusivo en ambos lados y por debajo no se confirma', () => {
    const m = MIN_SELECTION_DIP
    assert.equal(run([{ type: 'down', point: p(0, 0) }, { type: 'up', point: p(m, m) }]).effects.length, 1)
    assert.equal(run([{ type: 'down', point: p(0, 0) }, { type: 'up', point: p(m - 1, 500) }]).effects.length, 0)
    assert.equal(run([{ type: 'down', point: p(0, 0) }, { type: 'up', point: p(500, m - 1) }]).effects.length, 0)
  })

  test('tras una selección diminuta se puede intentar otra', () => {
    const { effects } = run([
      { type: 'down', point: p(10, 10) }, { type: 'up', point: p(12, 12) },
      { type: 'down', point: p(20, 20) }, { type: 'up', point: p(220, 120) },
    ])
    assert.deepEqual(effects, [{ type: 'confirm', rect: { x: 20, y: 20, width: 200, height: 100 } }])
  })
})

describe('cancelar y reutilizar', () => {
  test('Escape o el botón derecho cancelan, también en pleno arrastre', () => {
    assert.deepEqual(run([{ type: 'key', key: 'Escape' }]).effects, [{ type: 'cancel' }])
    assert.deepEqual(run([{ type: 'down', point: p(1, 1) }, { type: 'move', point: p(90, 90) }, { type: 'key', key: 'Escape' }]).effects, [{ type: 'cancel' }])
    assert.deepEqual(run([{ type: 'context' }]).effects, [{ type: 'cancel' }])
  })

  test('otras teclas no hacen nada', () => {
    assert.deepEqual(run([{ type: 'key', key: 'a' }, { type: 'key', key: 'Tab' }]).effects, [])
  })

  test('la región anterior se muestra como punto de partida', () => {
    const previous = { x: 10, y: 20, width: 300, height: 80 }
    assert.deepEqual(visibleRect(initialState(previous)), { rect: previous, previous: true })
    assert.equal(visibleRect(initialState(null)), null)
  })

  test('Enter confirma la región anterior tal cual; sin región anterior no hace nada', () => {
    const previous = { x: 10, y: 20, width: 300, height: 80 }
    assert.deepEqual(run([{ type: 'key', key: 'Enter' }], previous).effects, [{ type: 'confirm', rect: previous }])
    assert.deepEqual(run([{ type: 'key', key: 'Enter' }]).effects, [])
  })

  test('Enter no confirma a mitad de un arrastre ni una región anterior demasiado pequeña', () => {
    const previous = { x: 10, y: 20, width: 300, height: 80 }
    assert.deepEqual(run([{ type: 'down', point: p(1, 1) }, { type: 'key', key: 'Enter' }], previous).effects, [])
    assert.deepEqual(run([{ type: 'key', key: 'Enter' }], { x: 0, y: 0, width: 3, height: 3 }).effects, [])
  })

  test('mientras se arrastra, la región anterior deja de dibujarse', () => {
    const previous = { x: 10, y: 20, width: 300, height: 80 }
    const { state } = run([{ type: 'down', point: p(0, 0) }, { type: 'move', point: p(40, 40) }], previous)
    assert.equal(visibleRect(state)?.previous, false)
  })
})
