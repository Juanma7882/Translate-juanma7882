import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import type { Notice } from '../shared/ipc.ts'
import type { Command } from '../shared/protocol.ts'
import { defaultSettings } from '../shared/settings.ts'
import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import type { DisplaySource } from './overlay-picker.ts'
import type { RegionPicker } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** Ajustes en memoria con los mismos contratos que `SettingsStore` (get, update, onChange). */
function fakeSettings() {
  let current = defaultSettings()
  const listeners: ((s: typeof current) => void)[] = []
  const settings = {
    get: () => structuredClone(current),
    update: (patch: Partial<typeof current>) => {
      current = { ...current, ...patch }
      for (const listener of listeners) listener(structuredClone(current))
      return { ok: true }
    },
    onChange: (listener: (s: typeof current) => void) => {
      listeners.push(listener)
      return () => undefined
    },
  } as unknown as SettingsStore
  return { settings }
}

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
  const store = fakeSettings()
  const settings = store.settings
  const displays: DisplaySource = {
    all: () => [{ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1050 }, scaleFactor: 1, isPrimary: true }],
    underCursor: () => ({ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1050 }, scaleFactor: 1, isPrimary: true }),
  }
  const controller = new AppController({
    host: host as unknown as EngineHost,
    windows: { get: () => undefined } as unknown as WindowManager,
    settings,
    picker: {} as RegionPicker,
    displays,
    configure: () => Promise.resolve(),
  })
  const notices: Notice[] = []
  controller.on('notice', (n) => notices.push(n))
  return { host, controller, notices, store }
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

test('el aviso de región sin texto sale como clearText, sin contenido ni avisos', () => {
  const { host, controller, notices } = setup()
  const cleared: unknown[][] = []
  controller.on('clearText', (...args: unknown[]) => cleared.push(args))
  host.emit('event', { name: 'textCleared', payload: { cleared: true } })
  assert.deepEqual(cleared, [[]])
  assert.equal(notices.length, 0)
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
  assert.deepEqual(controller.state, { running: false, paused: false, mode: null, phase: 'error' })
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

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('el modo automático y el de solo texto piden una región; el de solo audio no', async () => {
  const { host, controller, store, notices } = setup()
  assert.equal(await controller.start(REGION), true)
  assert.equal(host.sent.at(-1)?.type, 'startRegion')
  assert.deepEqual(controller.state, { running: true, paused: false, mode: 'text', phase: 'running' })

  store.settings.update({ mode: 'audio' } as never)
  await tick()
  assert.equal(host.sent.at(-1)?.type, 'startAudio', 'cambiar el modo reinicia la sesión en audio')
  assert.deepEqual(controller.state, { running: true, paused: false, mode: 'audio', phase: 'running' })

  // En audio se puede empezar sin región.
  await controller.stop()
  assert.equal(await controller.startSaved(), true)
  assert.equal(host.sent.at(-1)?.type, 'startAudio')

  // Sin región, los otros modos avisan en vez de arrancar.
  await controller.stop()
  store.settings.update({ mode: 'text' } as never)
  assert.equal(await controller.start(null), false)
  assert.match(notices.at(-1)!.message, /región/)
})

test('el atajo cicla auto, texto, audio y vuelve a auto', async () => {
  const { controller, store } = setup()
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    controller.cycleMode()
    seen.push(store.settings.get().mode)
  }
  assert.deepEqual(seen, ['text', 'audio', 'auto', 'text'])
})

test('cambiar de modo en reposo solo guarda el ajuste', async () => {
  const { host, controller, store } = setup()
  controller.setMode('audio')
  await tick()
  assert.equal(store.settings.get().mode, 'audio')
  assert.equal(host.sent.length, 0)
})

test('la espera del fallback también reinicia la sesión en automático', async () => {
  const { host, controller, store } = setup()
  await controller.start(REGION)
  host.sent = []
  store.settings.update({ fallbackSeconds: 9 } as never)
  await tick()
  assert.ok(host.sent.some((c) => c.type === 'startRegion'))
})

test('en automático el modo activo sigue los eventos del motor; en los forzados se ignoran', async () => {
  const { host, controller, store } = setup()
  await controller.start(REGION)
  host.emit('event', { name: 'mode', payload: { mode: 'audio' } })
  assert.equal(controller.state.mode, 'audio')
  host.emit('event', { name: 'mode', payload: { mode: 'paused' } })
  assert.deepEqual(controller.state, { running: true, paused: true, mode: 'audio', phase: 'paused' }, 'la pausa conserva el modo')
  host.emit('event', { name: 'mode', payload: { mode: 'text' } })
  assert.deepEqual(controller.state, { running: true, paused: false, mode: 'text', phase: 'running' })

  store.settings.update({ mode: 'text' } as never)
  await tick()
  host.emit('event', { name: 'mode', payload: { mode: 'audio' } })
  assert.equal(controller.state.mode, 'text', 'en solo texto un evento rezagado no cambia el modo')
})

test('un evento de modo sin sesión no la resucita', async () => {
  const { host, controller } = setup()
  host.emit('event', { name: 'mode', payload: { mode: 'text' } })
  assert.equal(controller.state.running, false)
})

test('en solo audio pausar detiene la captura y reanudar la vuelve a arrancar', async () => {
  const { host, controller, store } = setup()
  store.settings.update({ mode: 'audio' } as never)
  await controller.startSaved()
  host.sent = []
  await controller.togglePause()
  assert.equal(controller.state.paused, true)
  await controller.togglePause()
  assert.equal(controller.state.paused, false)
  assert.deepEqual(host.sent.map((c) => c.type), ['stop', 'startAudio'])
})
