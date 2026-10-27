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
    setMode: record('mode'),
    stop: record('stop'),
    openSettings: record('settings'),
    quit: record('quit'),
  }
}

const item = (template: ReturnType<typeof trayTemplate>, prefix: string) => template.find((i) => i.label?.startsWith(prefix))!

test('en reposo solo se puede elegir, traducir la última región, abrir ajustes y salir', () => {
  const template = trayTemplate({ running: false, paused: false, mode: null }, true, actions([]))
  assert.equal(item(template, 'Pausar').enabled, false)
  assert.equal(item(template, 'Detener').enabled, false)
  assert.equal(item(template, 'Traducir').enabled, true)
  assert.equal(item(trayTemplate({ running: false, paused: false, mode: null }, false, actions([])), 'Traducir').enabled, false)
})

test('en marcha se puede pausar y detener; en pausa el elemento pasa a "Reanudar"', () => {
  const running = trayTemplate({ running: true, paused: false, mode: 'text' as const }, true, actions([]))
  assert.equal(item(running, 'Pausar').enabled, true)
  assert.equal(item(running, 'Traducir').enabled, false)
  const paused = trayTemplate({ running: true, paused: true, mode: 'text' as const }, true, actions([]))
  assert.ok(item(paused, 'Reanudar'))
  assert.ok(!paused.some((i) => i.label === 'Pausar'))
})

test('cada elemento invoca su acción', () => {
  const calls: string[] = []
  const template = trayTemplate({ running: true, paused: false, mode: 'text' as const }, true, actions(calls))
  for (const prefix of ['Elegir', 'Traducir', 'Pausar', 'Detener', 'Ajustes', 'Salir']) {
    ;(item(template, prefix).click as () => void)()
  }
  assert.deepEqual(calls, ['choose', 'last', 'pause', 'stop', 'settings', 'quit'])
})

test('la descripción de la bandeja refleja el estado', () => {
  assert.match(trayTooltip({ running: false, paused: false, mode: null }), /reposo/)
  assert.match(trayTooltip({ running: true, paused: false, mode: 'text' as const }), /traduciendo/)
  assert.match(trayTooltip({ running: true, paused: true, mode: 'text' as const }), /pausa/)
})

test('el submenú "Modo" marca el modo elegido y cada opción lo cambia', () => {
  const modes: string[] = []
  const calls = actions([])
  calls.setMode = (mode) => void modes.push(mode)
  const template = trayTemplate({ running: false, paused: false, mode: null }, true, calls, 'text')
  const submenu = item(template, 'Modo').submenu as Electron.MenuItemConstructorOptions[]
  assert.deepEqual(submenu.map((i) => [i.label, i.checked]), [['Automático', false], ['Solo texto', true], ['Solo audio', false]])
  for (const option of submenu) (option.click as () => void)()
  assert.deepEqual(modes, ['auto', 'text', 'audio'])
})

test('en modo audio se puede traducir sin región guardada', () => {
  const idle = { running: false, paused: false, mode: null }
  assert.equal(item(trayTemplate(idle, false, actions([]), 'audio'), 'Traducir').enabled, true)
  assert.equal(item(trayTemplate(idle, false, actions([]), 'auto'), 'Traducir').enabled, false)
})

test('el tooltip incluye el modo activo', () => {
  assert.match(trayTooltip({ running: true, paused: false, mode: 'audio' }), /audio/)
  assert.match(trayTooltip({ running: true, paused: false, mode: 'text' }), /texto/)
  assert.match(trayTooltip({ running: true, paused: true, mode: 'audio' }), /pausa.*audio/)
})
