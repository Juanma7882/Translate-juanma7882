import assert from 'node:assert/strict'
import { test } from 'node:test'

import { trayTemplate, trayTooltip } from './tray-menu.ts'
import type { TrayActions } from './tray-menu.ts'

function actions(calls: string[]): TrayActions {
  const record = (name: string) => () => void calls.push(name)
  return {
    chooseRegion: record('choose'),
    translateLast: record('last'),
    togglePause: record('pause'),
    stop: record('stop'),
    openSettings: record('settings'),
    quit: record('quit'),
  }
}

const item = (template: ReturnType<typeof trayTemplate>, prefix: string) => template.find((i) => i.label?.startsWith(prefix))!

test('en reposo solo se puede elegir, traducir la última región, abrir ajustes y salir', () => {
  const template = trayTemplate({ running: false, paused: false }, true, actions([]))
  assert.equal(item(template, 'Pausar').enabled, false)
  assert.equal(item(template, 'Detener').enabled, false)
  assert.equal(item(template, 'Traducir').enabled, true)
  assert.equal(item(trayTemplate({ running: false, paused: false }, false, actions([])), 'Traducir').enabled, false)
})

test('en marcha se puede pausar y detener; en pausa el elemento pasa a "Reanudar"', () => {
  const running = trayTemplate({ running: true, paused: false }, true, actions([]))
  assert.equal(item(running, 'Pausar').enabled, true)
  assert.equal(item(running, 'Traducir').enabled, false)
  const paused = trayTemplate({ running: true, paused: true }, true, actions([]))
  assert.ok(item(paused, 'Reanudar'))
  assert.ok(!paused.some((i) => i.label === 'Pausar'))
})

test('cada elemento invoca su acción', () => {
  const calls: string[] = []
  const template = trayTemplate({ running: true, paused: false }, true, actions(calls))
  for (const prefix of ['Elegir', 'Traducir', 'Pausar', 'Detener', 'Ajustes', 'Salir']) {
    ;(item(template, prefix).click as () => void)()
  }
  assert.deepEqual(calls, ['choose', 'last', 'pause', 'stop', 'settings', 'quit'])
})

test('la descripción de la bandeja refleja el estado', () => {
  assert.match(trayTooltip({ running: false, paused: false }), /reposo/)
  assert.match(trayTooltip({ running: true, paused: false }), /traduciendo/)
  assert.match(trayTooltip({ running: true, paused: true }), /pausa/)
})
