import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { toDesktopDip } from './geometry.ts'
import type { DisplayInfo } from './geometry.ts'
import { DEFAULT_GAP, placeOutside } from './overlay-placement.ts'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const overlay = { width: 800, height: 120 }

describe('placeOutside', () => {
  test('si cabe, va debajo de la región, centrado y con la separación por defecto', () => {
    const region = { x: 400, y: 300, width: 600, height: 100 }
    const p = placeOutside(region, screen, overlay)
    // Centro de la región: 400 + 600/2 = 700; el overlay mide 800, así que empieza en 700 - 400 = 300.
    assert.deepEqual(p, { x: 300, y: 300 + 100 + DEFAULT_GAP, overlaps: false })
  })

  test('si no cabe debajo, va encima', () => {
    const region = { x: 400, y: 900, width: 600, height: 100 } // bajo la región quedan 80 px
    const p = placeOutside(region, screen, overlay)
    assert.deepEqual(p, { x: 300, y: 900 - DEFAULT_GAP - 120, overlaps: false })
  })

  test('la separación es configurable', () => {
    const region = { x: 0, y: 0, width: 400, height: 100 }
    assert.equal(placeOutside(region, screen, overlay, 40).y, 140)
    assert.equal(placeOutside(region, screen, overlay, 0).y, 100)
  })

  test('se mantiene dentro del área de trabajo en los bordes horizontales', () => {
    const left = placeOutside({ x: 0, y: 100, width: 100, height: 50 }, screen, overlay)
    assert.equal(left.x, 0)
    const right = placeOutside({ x: 1820, y: 100, width: 100, height: 50 }, screen, overlay)
    assert.equal(right.x, 1920 - 800)
  })

  test('respeta el área de trabajo (barra de tareas) y no solo los límites de la pantalla', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1040 } // barra de tareas de 40 px
    const region = { x: 400, y: 880, width: 600, height: 100 } // debajo quedarían 60 px < 120
    const p = placeOutside(region, work, overlay)
    assert.equal(p.y, 880 - DEFAULT_GAP - 120)
    assert.ok(p.y + overlay.height <= 1040)
  })

  test('en un segundo monitor con origen negativo todo se desplaza con él', () => {
    const work = { x: -1280, y: 100, width: 1280, height: 1024 }
    const region = { x: -1000, y: 200, width: 400, height: 100 }
    const p = placeOutside(region, work, { width: 600, height: 100 })
    assert.deepEqual(p, { x: -1100, y: 312, overlaps: false })
  })

  test('si la región deja menos de un overlay a ambos lados se elige el lado con más espacio y se avisa del solapamiento', () => {
    // Arriba quedan 100 px y abajo 80: no cabe un overlay de 120 en ninguno de los dos.
    const region = { x: 100, y: 100, width: 1700, height: 900 }
    const p = placeOutside(region, screen, overlay)
    assert.equal(p.y, 0, 'arriba hay más espacio (100 > 80): se pega al borde superior')
    assert.equal(p.overlaps, true, 'el overlay [0,120) tapa el borde superior de la región (desde y = 100)')
  })

  test('si cabe el overlay pero no la separación, se pega al borde sin solapar', () => {
    // Arriba 125 px (cabe un overlay de 120 pero no con 12 de separación) y abajo 115.
    const region = { x: 100, y: 125, width: 1700, height: 840 }
    const p = placeOutside(region, screen, overlay)
    assert.deepEqual(p, { x: 550, y: 0, overlaps: false })
  })

  test('si ni arriba ni abajo hay hueco, pero abajo hay más, va pegado al borde inferior', () => {
    const region = { x: 100, y: 60, width: 1700, height: 900 } // arriba 60, abajo 120
    const p = placeOutside(region, screen, overlay)
    assert.equal(p.y, 1080 - 120)
    assert.equal(p.overlaps, false, 'justo en contacto con el borde de la región, sin tapar nada')
  })

  test('una región que ocupa toda la pantalla solapa inevitablemente', () => {
    const p = placeOutside(screen, screen, overlay)
    assert.equal(p.overlaps, true)
    assert.ok(p.y >= 0 && p.y + 120 <= 1080 && p.x >= 0 && p.x + 800 <= 1920, 'sigue dentro de la pantalla')
  })

  test('un overlay más ancho que el área de trabajo queda pegado al borde izquierdo', () => {
    const p = placeOutside({ x: 500, y: 100, width: 100, height: 50 }, { x: 0, y: 0, width: 600, height: 400 }, { width: 900, height: 80 })
    assert.equal(p.x, 0)
  })

  test('es una función pura: no modifica sus entradas', () => {
    const region = Object.freeze({ x: 10, y: 10, width: 100, height: 100 })
    const work = Object.freeze({ ...screen })
    assert.doesNotThrow(() => placeOutside(region, work, overlay))
  })
})

describe('con una región guardada', () => {
  const primary: DisplayInfo = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, isPrimary: true }
  const second: DisplayInfo = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 1024 }, scaleFactor: 2, isPrimary: false }

  test('toDesktopDip suma el origen del monitor y divide por la escala', () => {
    const desktop = toDesktopDip({ x: 200, y: 100, width: 600, height: 160, monitor: 1 }, [primary, second])!
    assert.equal(desktop.display.id, 2)
    assert.deepEqual(desktop.rect, { x: 1920 + 100, y: 50, width: 300, height: 80 })
  })

  test('el overlay de una región del segundo monitor queda en ese monitor y fuera de la región', () => {
    const desktop = toDesktopDip({ x: 200, y: 100, width: 600, height: 160, monitor: 1 }, [primary, second])!
    const p = placeOutside(desktop.rect, desktop.display.workArea, { width: 500, height: 100 })
    assert.ok(p.x >= 1920 && p.x + 500 <= 1920 + 1280, 'dentro del segundo monitor')
    assert.equal(p.overlaps, false)
  })

  test('una región de un monitor que ya no existe no se puede ubicar', () => {
    assert.equal(toDesktopDip({ x: 0, y: 0, width: 10, height: 10, monitor: 5 }, [primary]), null)
  })
})
