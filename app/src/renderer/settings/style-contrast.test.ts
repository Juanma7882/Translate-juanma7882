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
