// El tema claro y el oscuro de Ajustes deben cumplir contraste AA en sus pares texto/fondo.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { contrastRatio, MIN_CONTRAST } from '../../shared/contrast.ts'

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')

/** Variables de un bloque `:root { ... }` (el primero es el claro; el de `@media dark`, el oscuro). */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]))
}

const light = tokens(css.slice(css.indexOf(':root'), css.indexOf('@media (prefers-color-scheme: dark)')))
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('body {', darkStart))) }

/** (texto, fondo, descripción) que la interfaz usa de verdad. */
const PAIRS: [string, string, string][] = [
  ['text', 'bg', 'texto sobre el fondo'],
  ['text', 'surface', 'texto en controles'],
  ['muted', 'bg', 'texto secundario'],
  ['muted', 'surface', 'texto secundario en controles'],
  ['error', 'bg', 'errores'],
  ['warning', 'bg', 'avisos'],
  ['accent', 'bg', 'color de acento (bordes, foco)'],
  ['accent', 'surface', 'medidor de nivel y estado activo sobre superficie'],
  ['accent-text', 'accent', 'pestaña activa y botón principal'],
  ['danger', 'bg', 'botones de borrar'],
  ['focus', 'bg', 'anillo de foco'],
]

for (const [name, theme] of [
  ['claro', light],
  ['oscuro', dark],
] as const) {
  describe(`tema ${name}`, () => {
    for (const [fg, bg, what] of PAIRS) {
      test(`${what} (${fg} sobre ${bg}) llega a ${MIN_CONTRAST}:1`, () => {
        assert.ok(theme[fg] && theme[bg], `faltan variables ${fg}/${bg}`)
        const ratio = contrastRatio(theme[fg]!, theme[bg]!)
        assert.ok(ratio >= MIN_CONTRAST, `${ratio.toFixed(2)}:1`)
      })
    }

    test('los bordes de los controles llegan a 3:1 (componentes de interfaz)', () => {
      assert.ok(contrastRatio(theme['border']!, theme['bg']!) >= 3)
    })
  })
}

/** Valor de una propiedad en el primer bloque `selector { ... }` que empieza en su propia línea. */
function declared(selector: string, property: string): string | undefined {
  const lines = css.split(String.fromCharCode(10)).map((line) => line.trimEnd())
  const start = lines.indexOf(`${selector} {`)
  if (start < 0) return undefined
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('}')) return undefined
    const [name, ...rest] = line.trim().split(':')
    if (name === property) return rest.join(':').trim().replace(/;$/, '')
  }
  return undefined
}

describe('colores de la pestaña Inicio y de la vista previa fija', () => {
  // Cada uno usa un par texto/fondo ya cubierto arriba, así que basta con comprobar qué tokens se usan.
  test('la guía pinta texto secundario y acento sobre la superficie', () => {
    assert.equal(declared('.guide', 'background'), 'var(--surface)')
    assert.equal(declared('.guide', 'border'), '1px solid var(--accent)')
    assert.equal(declared('.guide-step.done', 'color'), 'var(--muted)')
    assert.ok(PAIRS.some(([fg, bg]) => fg === 'muted' && bg === 'surface'))
    assert.ok(PAIRS.some(([fg, bg]) => fg === 'accent' && bg === 'surface'))
  })

  test('el botón principal usa texto de acento sobre el acento', () => {
    assert.equal(declared('button.primary', 'color'), 'var(--accent-text)')
    assert.equal(declared('button.primary', 'background'), 'var(--accent)')
  })

  test('la nota de la escucha previa usa texto secundario y, con error, el color de error sobre el fondo', () => {
    assert.equal(declared('.meter-note.error', 'color'), 'var(--error)')
    assert.ok(PAIRS.some(([fg, bg]) => fg === 'error' && bg === 'bg'))
    assert.ok(PAIRS.some(([fg, bg]) => fg === 'muted' && bg === 'bg'))
  })

  test('la vista previa fija tiene fondo opaco del tema para no dejar ver lo que pasa por debajo', () => {
    assert.equal(declared('.preview-sticky', 'background'), 'var(--bg)')
    assert.equal(declared('.preview-sticky', 'position'), 'sticky')
  })
})
