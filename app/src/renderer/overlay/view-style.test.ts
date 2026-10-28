import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { OverlayStyle } from '../../shared/ipc.ts'
import { cssVariables } from './view.ts'

const style: OverlayStyle = {
  opacity: 0.6,
  fontSize: 30,
  fontFamily: 'Georgia, serif',
  showOriginal: true,
  hideAfterMs: 4000,
  textColor: '#ffee00',
  backgroundColor: '#102030',
  maxLines: 3,
}

describe('cssVariables', () => {
  test('traduce el estilo a variables CSS', () => {
    const vars = cssVariables(style)
    assert.equal(vars['--text-color'], '#ffee00')
    assert.equal(vars['--bg-rgb'], '16, 32, 48')
    assert.equal(vars['--max-lines'], '3')
    assert.equal(vars['--font-size'], '30px')
    assert.equal(vars['--opacity'], '0.6')
    assert.equal(vars['--font-family'], 'Georgia, serif')
  })

  test('la sombra es oscura con texto claro y clara con texto oscuro', () => {
    assert.match(cssVariables(style)['--shadow-color']!, /0, 0, 0/)
    assert.match(cssVariables({ ...style, textColor: '#101010', backgroundColor: '#ffffff' })['--shadow-color']!, /255, 255, 255/)
  })
})
