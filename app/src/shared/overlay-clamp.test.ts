import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clampToAreas, MIN_VISIBLE } from './overlay-placement.ts'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const size = { width: 900, height: 120 }

test('una posición dentro de la pantalla no cambia', () => {
  assert.deepEqual(clampToAreas({ x: 100, y: 200, ...size }, [screen]), { x: 100, y: 200 })
})

test('no se puede sacar por arriba ni por abajo', () => {
  assert.equal(clampToAreas({ x: 0, y: -500, ...size }, [screen]).y, 0)
  assert.equal(clampToAreas({ x: 0, y: 5000, ...size }, [screen]).y, 1080 - MIN_VISIBLE)
})

test('por los lados siempre queda un trozo visible', () => {
  assert.equal(clampToAreas({ x: -5000, y: 10, ...size }, [screen]).x, -size.width + MIN_VISIBLE)
  assert.equal(clampToAreas({ x: 9000, y: 10, ...size }, [screen]).x, 1920 - MIN_VISIBLE)
})

test('con varios monitores se usa la caja que los envuelve', () => {
  const second = { x: 1920, y: -200, width: 1280, height: 1024 }
  assert.deepEqual(clampToAreas({ x: 2500, y: -150, ...size }, [screen, second]), { x: 2500, y: -150 })
  assert.equal(clampToAreas({ x: 0, y: -900, ...size }, [screen, second]).y, -200)
})

test('sin áreas no cambia nada', () => {
  assert.deepEqual(clampToAreas({ x: 1, y: 2, ...size }, []), { x: 1, y: 2 })
})
