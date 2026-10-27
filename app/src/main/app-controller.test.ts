import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import type { Notice } from '../shared/ipc.ts'
import type { Command } from '../shared/protocol.ts'
import { defaultSettings } from '../shared/settings.ts'
import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import type { RegionPicker } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

class FakeHost extends EventEmitter {
  isReady = true
  sent: Command[] = []
  failWith: string | null = null
  whenReady = () => Promise.resolve()
  send = (command: Command) => {
    this.sent.push(command)
    return this.failWith ? Promise.reject(new Error(this.failWith)) : Promise.resolve(undefined)
  }
}

function setup() {
  const host = new FakeHost()
  const settings = { get: () => defaultSettings(), update: () => ({ ok: true }) } as unknown as SettingsStore
  const controller = new AppController({
    host: host as unknown as EngineHost,
    windows: { get: () => undefined } as unknown as WindowManager,
    settings,
    picker: {} as RegionPicker,
    configure: () => Promise.resolve(),
  })
  const notices: Notice[] = []
  controller.on('notice', (n) => notices.push(n))
  return { host, controller, notices }
}

const REGION = { x: 0, y: 0, width: 10, height: 10, monitor: 0 }

test('cada categoría de error del motor produce un aviso comprensible', () => {
  const { host, notices } = setup()
  const expected: Record<string, RegExp> = {
    capture: /capturar la pantalla/,
    ocr: /reconocer el texto/,
    translation: /No se pudo traducir/,
    stt: /transcribir el audio/,
    model: /modelos/,
    'invalid-argument': /Ajuste no válido/,
    unknown: /Error del motor/,
  }
  for (const [category, pattern] of Object.entries(expected)) {
    host.emit('event', { name: 'error', payload: { category, message: 'detalle técnico' } })
    const notice = notices.at(-1)!
    assert.equal(notice.level, 'error', category)
    assert.match(notice.message, pattern, category)
  }
  assert.equal(notices.length, Object.keys(expected).length)
})

test('los avisos nunca incluyen el texto capturado ni traducido', () => {
  const { host, notices } = setup()
  host.emit('event', { name: 'translation', payload: { original: 'SECRETO original', translated: 'SECRETO traducido' } })
  for (const category of ['capture', 'ocr', 'translation', 'model']) {
    host.emit('event', { name: 'error', payload: { category, message: 'fallo' } })
  }
  host.emit('crashed', { exitCode: 1, restartInMs: 250 })
  assert.ok(notices.length >= 5)
  assert.ok(notices.every((n) => !n.message.includes('SECRETO')))
})

test('faltan modelos: el aviso lleva el código que ofrece la descarga', () => {
  const { host, notices } = setup()
  host.emit('event', { name: 'error', payload: { category: 'model', message: 'missing models: ocr-x' } })
  assert.equal(notices[0]!.code, 'models-missing')
})

test('un fallo al iniciar deja el estado en reposo y avisa', async () => {
  const { host, controller, notices } = setup()
  host.failWith = 'missing models: translate-en-es'
  assert.equal(await controller.start(REGION), false)
  assert.deepEqual(controller.state, { running: false, paused: false })
  assert.equal(notices.length, 1)
  assert.equal(notices[0]!.code, 'models-missing')
  assert.match(notices[0]!.message, /No se pudo iniciar/)
})

test('si el motor se cae mientras traduce avisa y vuelve a traducir al reiniciarse', async () => {
  const { host, controller, notices } = setup()
  assert.equal(await controller.start(REGION), true)
  assert.equal(controller.state.running, true)
  host.emit('crashed', { exitCode: 139, restartInMs: 250 })
  assert.equal(controller.state.running, false)
  assert.equal(notices.at(-1)!.level, 'warning')
  host.sent = []
  host.emit('ready')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(host.sent.some((c) => c.type === 'startRegion'), 'retoma la región')
  assert.equal(controller.state.running, true)
})

test('pausar y reanudar llegan al motor y solo valen con una traducción en marcha', async () => {
  const { host, controller } = setup()
  await controller.pause()
  assert.equal(host.sent.length, 0, 'en reposo no hay nada que pausar')
  await controller.start(REGION)
  host.sent = []
  await controller.togglePause()
  assert.equal(controller.state.paused, true)
  await controller.togglePause()
  assert.equal(controller.state.paused, false)
  assert.deepEqual(host.sent.map((c) => c.type), ['pause', 'resume'])
})
