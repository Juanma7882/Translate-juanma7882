// Cola de órdenes, reinicio, fuente de audio y espera de la aplicación elegida (AppController).

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import type { Command } from '../shared/protocol.ts'
import { defaultSettings } from '../shared/settings.ts'
import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import type { RegionPicker } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

function fakeSettings() {
  let current = defaultSettings()
  const listeners: ((s: typeof current) => void)[] = []
  return {
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
}

class FakeHost extends EventEmitter {
  isReady = true
  sent: Command[] = []
  failWith: string | null = null
  sources: unknown = { supported: true, apps: [] }
  /** Si se pone, las órdenes de inicio esperan a que se resuelva (motor lento). */
  gate: Promise<void> | null = null
  whenReady = () => Promise.resolve()
  send = async (command: Command) => {
    this.sent.push(command)
    if (this.gate && (command.type === 'startAudio' || command.type === 'startRegion')) await this.gate
    if (this.failWith) throw new Error(this.failWith)
    return command.type === 'listAudioSources' ? this.sources : undefined
  }
}

/** Temporizador manual: `fire` dispara los pendientes. */
function manualTimers() {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimer: (callback: () => void) => {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    clearTimer: (handle: unknown) => void pending.delete(handle as number),
    get count() {
      return pending.size
    },
    fire() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
  }
}

function setup() {
  const host = new FakeHost()
  const settings = fakeSettings()
  const timers = manualTimers()
  const controller = new AppController({
    host: host as unknown as EngineHost,
    windows: { get: () => undefined } as unknown as WindowManager,
    settings,
    picker: {} as RegionPicker,
    overlayPicker: () => ({ pick: () => Promise.resolve(null), preview: () => Promise.resolve(false) }),
    configure: () => Promise.resolve(),
    timers,
  })
  const notices: { level: string; message: string; code?: string }[] = []
  controller.on('notice', (n) => notices.push(n))
  return { host, controller, notices, settings, timers }
}

const REGION = { x: 0, y: 0, width: 10, height: 10, monitor: 0 }
const APP_SOURCE = { kind: 'app', program: 'firefox.exe' }
const tick = () => new Promise((resolve) => setImmediate(resolve))
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick()
}
const count = (host: FakeHost, type: Command['type']) => host.sent.filter((c) => c.type === type).length
const sourceOf = (command: Command | undefined) => (command && command.type === 'startAudio' ? command.source : null)
const gateOn = (host: FakeHost) => {
  let release!: () => void
  host.gate = new Promise((resolve) => (release = resolve))
  return release
}

test('el estado pasa por iniciando mientras el motor responde', async () => {
  const { host, controller } = setup()
  const release = gateOn(host)
  const phases: string[] = []
  controller.on('state', (s) => phases.push(s.phase))
  const started = controller.start(REGION)
  await flush()
  assert.equal(controller.state.phase, 'starting')
  release()
  assert.equal(await started, true)
  assert.deepEqual(phases, ['starting', 'running'])
})

test('reiniciar tres veces seguidas deja una única sesión sin capturas duplicadas', async () => {
  const { host, controller } = setup()
  await controller.start(REGION)
  host.sent = []
  await Promise.all([controller.restart(), controller.restart(), controller.restart()])
  assert.equal(count(host, 'startRegion'), 1)
  assert.equal(count(host, 'stop'), 1)
  assert.equal(controller.state.phase, 'running')
})

test('reiniciar con un reinicio en marcha se une a él; sin sesión no hace nada', async () => {
  const { host, controller } = setup()
  await controller.restart()
  assert.equal(host.sent.length, 0)
  await controller.start(REGION)
  host.sent = []
  const release = gateOn(host)
  const first = controller.restart()
  await flush()
  const second = controller.restart()
  release()
  await Promise.all([first, second])
  assert.equal(count(host, 'startRegion'), 1)
})

test('las órdenes se ejecutan de una en una y en orden', async () => {
  const { host, controller } = setup()
  const release = gateOn(host)
  const order: string[] = []
  const started = controller.start(REGION).then(() => order.push('start'))
  const paused = controller.pause().then(() => order.push('pause'))
  const stopped = controller.stop().then(() => order.push('stop'))
  await flush()
  assert.deepEqual(order, [], 'nada termina antes de que el motor conteste')
  release()
  await Promise.all([started, paused, stopped])
  assert.deepEqual(order, ['start', 'pause', 'stop'])
  assert.deepEqual(host.sent.map((c) => c.type), ['startRegion', 'pause', 'stop'])
  assert.equal(controller.state.phase, 'idle')
})

test('Iniciar varias veces seguidas arranca una sola captura', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'audio' } as never)
  await Promise.all([controller.startSession(), controller.startSession(), controller.startSession()])
  assert.equal(count(host, 'startAudio'), 1)
  assert.equal(controller.state.phase, 'running')
})

test('la fuente de una aplicación se resuelve por nombre de programa y viaja con su id', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  host.sources = {
    supported: true,
    apps: [
      { id: 3, name: 'chrome.exe' },
      { id: 42, name: 'Firefox.exe' },
    ],
  }
  await controller.startSession()
  assert.deepEqual(sourceOf(host.sent.find((c) => c.type === 'startAudio')), { kind: 'app', id: 42, name: 'Firefox.exe' })
  assert.equal(controller.state.phase, 'running')
})

test('el sistema entero viaja como fuente explícita', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'audio' } as never)
  await controller.startSession()
  assert.deepEqual(sourceOf(host.sent.find((c) => c.type === 'startAudio')), { kind: 'system' })
  assert.equal(count(host, 'listAudioSources'), 0)
})

test('si la aplicación no suena la sesión espera, avisa y arranca sola cuando aparece', async () => {
  const { host, controller, settings, notices, timers } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  await controller.startSession()
  assert.deepEqual(controller.state, { running: true, paused: false, mode: 'audio', phase: 'waiting', waitingFor: 'firefox.exe' })
  assert.equal(count(host, 'startAudio'), 0)
  assert.match(notices.at(-1)!.message, /firefox\.exe/)
  assert.equal(timers.count, 1)

  timers.fire()
  await flush()
  assert.equal(controller.state.phase, 'waiting', 'sigue esperando')
  assert.equal(timers.count, 1, 'reintenta de nuevo')

  host.sources = { supported: true, apps: [{ id: 9, name: 'firefox.exe' }] }
  timers.fire()
  await flush()
  assert.equal(controller.state.phase, 'running')
  assert.equal(controller.state.waitingFor, undefined)
  assert.equal(count(host, 'startAudio'), 1)
  assert.equal(timers.count, 0)
})

test('detener cancela la espera y no se reanuda después', async () => {
  const { host, controller, settings, timers } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  await controller.startSession()
  await controller.stop()
  assert.equal(controller.state.phase, 'idle')
  assert.equal(timers.count, 0)
  host.sources = { supported: true, apps: [{ id: 9, name: 'firefox.exe' }] }
  timers.fire()
  await flush()
  assert.equal(count(host, 'startAudio'), 0)
  assert.equal(controller.state.phase, 'idle')
})

test('la aplicación se cierra con la sesión en marcha: pasa a espera y vuelve cuando suena', async () => {
  const { host, controller, settings, timers } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  host.sources = { supported: true, apps: [{ id: 5, name: 'firefox.exe' }] }
  await controller.startSession()
  assert.equal(controller.state.phase, 'running')
  host.sources = { supported: true, apps: [] }
  host.emit('event', { name: 'error', payload: { category: 'capture', message: 'source lost' } })
  await flush()
  assert.equal(controller.state.phase, 'waiting')
  host.sources = { supported: true, apps: [{ id: 6, name: 'firefox.exe' }] }
  timers.fire()
  await flush()
  assert.equal(controller.state.phase, 'running')
})

test('una plataforma sin captura por aplicación no inicia y lo explica', async () => {
  const { host, controller, settings, notices } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  host.sources = { supported: false, reason: 'not available on this platform' }
  await controller.startSession()
  assert.equal(controller.state.phase, 'error')
  assert.equal(controller.state.running, false)
  assert.match(notices.at(-1)!.message, /no permite capturar/)
})

test('cambiar la fuente con la sesión en marcha la reinicia con la nueva', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'audio' } as never)
  await controller.startSession()
  host.sent = []
  host.sources = { supported: true, apps: [{ id: 5, name: 'firefox.exe' }] }
  settings.update({ audioSource: APP_SOURCE } as never)
  await flush()
  assert.deepEqual(sourceOf(host.sent.find((c) => c.type === 'startAudio')), { kind: 'app', id: 5, name: 'firefox.exe' })
  assert.equal(count(host, 'stop'), 1)
})

test('cambiar la fuente en modo solo texto no reinicia nada', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'text' } as never)
  await controller.start(REGION)
  host.sent = []
  settings.update({ audioSource: APP_SOURCE } as never)
  await flush()
  assert.equal(host.sent.length, 0)
})

test('pausar en audio con aplicación y reanudar vuelve a resolver la fuente', async () => {
  const { host, controller, settings } = setup()
  settings.update({ mode: 'audio', audioSource: APP_SOURCE } as never)
  host.sources = { supported: true, apps: [{ id: 5, name: 'firefox.exe' }] }
  await controller.startSession()
  await controller.pause()
  assert.equal(controller.state.phase, 'paused')
  host.sources = { supported: true, apps: [{ id: 8, name: 'firefox.exe' }] }
  await controller.resume()
  assert.deepEqual(sourceOf(host.sent.filter((c) => c.type === 'startAudio').at(-1)), { kind: 'app', id: 8, name: 'firefox.exe' })
  assert.equal(controller.state.phase, 'running')
})

test('faltan modelos al iniciar: error con el código que lleva a descargar', async () => {
  const { host, controller, settings, notices } = setup()
  settings.update({ mode: 'audio' } as never)
  host.failWith = 'missing models: stt-en'
  await controller.startSession()
  assert.equal(controller.state.phase, 'error')
  assert.equal(notices.at(-1)!.code, 'models-missing')
})
