import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MIN_SELECTION_DIP, monitorIndex, orderDisplays, toDipRect, toPhysicalRegion } from './geometry.ts'
import type { DisplayInfo } from './geometry.ts'

const display = (id: number, x: number, y: number, width: number, height: number, scaleFactor = 1, isPrimary = false): DisplayInfo => ({
  id,
  bounds: { x, y, width, height },
  workArea: { x, y, width, height },
  scaleFactor,
  isPrimary,
})

describe('orderDisplays', () => {
  test('el principal va primero y el resto por posición', () => {
    const right = display(1, 1920, 0, 2560, 1440)
    const left = display(2, -1280, 100, 1280, 1024)
    const primary = display(3, 0, 0, 1920, 1080, 1, true)
    assert.deepEqual(orderDisplays([right, left, primary]).map((d) => d.id), [3, 2, 1])
  })

  test('sin ninguno marcado como principal (XWayland) manda la posición', () => {
    const a = display(1, 1920, 0, 100, 100)
    const b = display(2, 0, 0, 100, 100)
    assert.deepEqual(orderDisplays([a, b]).map((d) => d.id), [2, 1])
  })

  test('es estable con posiciones iguales y no modifica la entrada', () => {
    const input = [display(1, 0, 0, 100, 100), display(2, 0, 0, 200, 200)]
    assert.deepEqual(orderDisplays(input).map((d) => d.id), [1, 2])
    assert.deepEqual(input.map((d) => d.id), [1, 2])
    assert.deepEqual(orderDisplays([]), [])
  })

  test('monitorIndex sigue ese orden y da -1 para una pantalla desconocida', () => {
    const all = [display(1, 1920, 0, 100, 100), display(2, 0, 0, 100, 100, 1, true)]
    assert.equal(monitorIndex(all, all[1]!), 0)
    assert.equal(monitorIndex(all, all[0]!), 1)
    assert.equal(monitorIndex(all, display(9, 0, 0, 1, 1)), -1)
  })
})

describe('toPhysicalRegion', () => {
  const sel = { x: 100, y: 50, width: 300, height: 80 }

  test('con escala 1 la región es la misma y el monitor es el principal', () => {
    const d = display(1, 0, 0, 1920, 1080, 1, true)
    assert.deepEqual(toPhysicalRegion(sel, d, [d]), { x: 100, y: 50, width: 300, height: 80, monitor: 0 })
  })

  test('escalas 1.25, 1.5 y 2 multiplican y redondean los bordes', () => {
    const cases: Array<[number, { x: number; y: number; width: number; height: number }]> = [
      [1.25, { x: 125, y: 63, width: 375, height: 100 }], // y: 62.5 -> 63 ; borde inferior 162.5 -> 163
      [1.5, { x: 150, y: 75, width: 450, height: 120 }],
      [2, { x: 200, y: 100, width: 600, height: 160 }],
    ]
    for (const [scale, expected] of cases) {
      const d = display(1, 0, 0, 1920, 1080, scale, true)
      assert.deepEqual(toPhysicalRegion(sel, d, [d]), { ...expected, monitor: 0 }, `escala ${scale}`)
    }
  })

  test('el ancho sale de redondear los bordes, no de redondear el ancho', () => {
    const d = display(1, 0, 0, 1000, 1000, 1.5, true)
    // x = 10.3 -> 15.45 -> 15 ; borde derecho 20.3+10.3=30.6 -> 45.9 -> 46 ; ancho = 31 (no round(15.45) = 15)
    const region = toPhysicalRegion({ x: 10.3, y: 10, width: 20.3, height: 20 }, d, [d])
    assert.deepEqual(region, { x: 15, y: 15, width: 31, height: 30, monitor: 0 })
  })

  test('selecciones contiguas no dejan huecos ni se solapan', () => {
    const d = display(1, 0, 0, 1000, 1000, 1.25, true)
    const a = toPhysicalRegion({ x: 0, y: 0, width: 33.3, height: 20 }, d, [d])!
    const b = toPhysicalRegion({ x: 33.3, y: 0, width: 33.3, height: 20 }, d, [d])!
    assert.equal(a.x + a.width, b.x)
  })

  test('en un monitor con origen negativo la región sigue siendo relativa a él', () => {
    const primary = display(1, 0, 0, 1920, 1080, 1, true)
    const left = display(2, -1280, 100, 1280, 1024, 1.5)
    const region = toPhysicalRegion(sel, left, [primary, left])
    assert.deepEqual(region, { x: 150, y: 75, width: 450, height: 120, monitor: 1 })
  })

  test('en el segundo monitor el índice es el del orden y la región no se desplaza', () => {
    const primary = display(1, 0, 0, 1920, 1080, 1, true)
    const right = display(2, 1920, 0, 2560, 1440, 2)
    assert.deepEqual(toPhysicalRegion(sel, right, [right, primary]), { x: 200, y: 100, width: 600, height: 160, monitor: 1 })
  })

  test('una selección que sobresale se recorta a la pantalla', () => {
    const d = display(1, 0, 0, 800, 600, 2, true)
    assert.deepEqual(toPhysicalRegion({ x: 700, y: 550, width: 300, height: 200 }, d, [d]), { x: 1400, y: 1100, width: 200, height: 100, monitor: 0 })
    assert.deepEqual(toPhysicalRegion({ x: -50, y: -30, width: 150, height: 100 }, d, [d]), { x: 0, y: 0, width: 200, height: 140, monitor: 0 })
  })

  test('las selecciones demasiado pequeñas o fuera de la pantalla se rechazan', () => {
    const d = display(1, 0, 0, 800, 600, 1, true)
    const tiny = MIN_SELECTION_DIP - 1
    assert.equal(toPhysicalRegion({ x: 10, y: 10, width: tiny, height: 100 }, d, [d]), null)
    assert.equal(toPhysicalRegion({ x: 10, y: 10, width: 100, height: tiny }, d, [d]), null)
    assert.equal(toPhysicalRegion({ x: 900, y: 10, width: 100, height: 100 }, d, [d]), null)
    assert.equal(toPhysicalRegion({ x: 10, y: 10, width: 0, height: 0 }, d, [d]), null)
    assert.notEqual(toPhysicalRegion({ x: 10, y: 10, width: MIN_SELECTION_DIP, height: MIN_SELECTION_DIP }, d, [d]), null, 'el mínimo es inclusivo')
  })

  test('una pantalla que ya no existe devuelve null', () => {
    const d = display(1, 0, 0, 800, 600, 1, true)
    assert.equal(toPhysicalRegion({ x: 10, y: 10, width: 100, height: 100 }, display(7, 0, 0, 800, 600), [d]), null)
  })
})

describe('toDipRect', () => {
  test('es el inverso de toPhysicalRegion (ida y vuelta) para escalas habituales', () => {
    const primary = display(1, 0, 0, 1920, 1080, 1, true)
    for (const scale of [1, 1.25, 1.5, 2, 3]) {
      const d = display(2, 1920, 0, 2560, 1440, scale)
      const sel = { x: 120, y: 80, width: 400, height: 90 }
      const physical = toPhysicalRegion(sel, d, [primary, d])!
      const back = toDipRect(physical, [primary, d])!
      assert.equal(back.display.id, 2)
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        assert.ok(Math.abs(back.rect[key] - sel[key]) <= 1 / scale, `escala ${scale}, ${key}: ${back.rect[key]} vs ${sel[key]}`)
      }
    }
  })

  test('una región de un monitor que ya no existe devuelve null', () => {
    const d = display(1, 0, 0, 800, 600, 1, true)
    assert.equal(toDipRect({ x: 0, y: 0, width: 10, height: 10, monitor: 3 }, [d]), null)
  })
})
