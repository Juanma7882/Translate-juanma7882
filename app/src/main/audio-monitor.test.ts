// Escucha previa del nivel (AudioMonitor): cuándo se abre, cuándo cede y qué estado muestra.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { Channel } from '../shared/ipc.ts'
import type { AudioSourceChoice, MonitorState } from '../shared/ipc.ts'
import type { Command } from '../shared/protocol.ts'
import { AudioMonitor, registerMonitorIpc } from './audio-monitor.ts'
import type { MonitorDeps } from './audio-monitor.ts'
import { guardedHandle } from './session-ipc.ts'
import type { IpcRegistry } from './session-ipc.ts'

type Mode = 'auto' | 'text' | 'audio'

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

const tick = () => new Promise((resolve) => setImmediate(resolve))
const flush = async () => {
  for (let i = 0; i < 12; i++) await tick()
}

function setup(initial: { mode?: Mode; engines?: 'fake' | 'real'; audioSource?: AudioSourceChoice; running?: boolean } = {}) {
  const sent: Command[] = []
  const host = Object.assign(new EventEmitter(), {
    sources: { supported: true, apps: [] } as unknown,
    startResult: true as boolean,
    failStart: null as Error | null,
    send: async (command: Command): Promise<unknown> => {
      sent.push(command)
      if (command.type === 'listAudioSources') return host.sources
      if (command.type === 'startAudioMonitor') {
        if (host.failStart) throw host.failStart
        return host.startResult
      }
      return undefined
    },
  })
  const controller = Object.assign(new EventEmitter(), { state: { running: initial.running ?? false } })
  const settingsListeners: (() => void)[] = []
  const values = { mode: initial.mode ?? 'auto', engines: initial.engines ?? 'real', audioSource: initial.audioSource ?? ({ kind: 'system' } as AudioSourceChoice) }
  const settings = {
    values,
    get: () => ({ ...values }),
    onChange: (listener: () => void) => {
      settingsListeners.push(listener)
      return () => undefined
    },
    change(patch: Partial<typeof values>) {
      Object.assign(values, patch)
      for (const listener of settingsListeners) listener()
    },
  }
  const timers = manualTimers()
  let prepared = 0
  const monitor = new AudioMonitor({
    host: host as unknown as MonitorDeps['host'],
    controller: controller as unknown as MonitorDeps['controller'],
    settings: settings as unknown as MonitorDeps['settings'],
    prepare: async () => void prepared++,
    timers,
    recheckMs: 2000,
  })
  const states: MonitorState[] = []
  monitor.on('state', (s) => states.push(s))
  return {
    monitor,
    host,
    controller,
    settings,
    timers,
    sent,
    states,
    get prepared() {
      return prepared
    },
    starts: () => sent.filter((c): c is Extract<Command, { type: 'startAudioMonitor' }> => c.type === 'startAudioMonitor'),
    stops: () => sent.filter((c) => c.type === 'stopAudioMonitor'),
    sessionStarts: () => {
      controller.state.running = true
      controller.emit('state')
    },
    sessionEnds: () => {
      controller.state.running = false
      controller.emit('state')
    },
  }
}

const FIREFOX: AudioSourceChoice = { kind: 'app', program: 'firefox.exe' }

test('no escucha nada hasta que Inicio está a la vista', async () => {
  const t = setup()
  await flush()
  assert.deepEqual(t.sent, [])
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
})

test('con Inicio a la vista y sin sesión abre todo el sistema con los ajustes al día', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()
  assert.equal(t.prepared, 1)
  assert.deepEqual(t.starts(), [{ type: 'startAudioMonitor', source: { kind: 'system' } }])
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
  assert.deepEqual(t.states, [{ phase: 'starting' }, { phase: 'listening' }])
})

test('al dejar de verse Inicio la escucha se cierra', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()
  t.monitor.setWanted(false)
  await flush()
  assert.equal(t.stops().length, 1)
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
  // Declararlo de nuevo no manda una orden de cierre de más.
  t.monitor.setWanted(false)
  await flush()
  assert.equal(t.stops().length, 1)
})

test('en el modo «Solo texto» no se abre ninguna captura, y al cambiar de modo sí', async () => {
  const t = setup({ mode: 'text' })
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.sent, [])
  assert.deepEqual(t.monitor.state, { phase: 'idle' })

  t.settings.change({ mode: 'audio' })
  await flush()
  assert.equal(t.starts().length, 1)
  assert.deepEqual(t.monitor.state, { phase: 'listening' })

  t.settings.change({ mode: 'text' })
  await flush()
  assert.equal(t.stops().length, 1, 'al pasar a «Solo texto» se cierra')
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
})

test('cede ante la sesión y vuelve a escuchar cuando termina', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()

  t.sessionStarts()
  await flush()
  assert.equal(t.stops().length, 1, 'se cierra antes de que la sesión abra su captura')
  assert.deepEqual(t.monitor.state, { phase: 'idle' })

  t.sessionEnds()
  await flush()
  assert.equal(t.starts().length, 2)
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
})

test('si el motor responde que una sesión lo ocupa, queda en reposo sin mostrar ningún error', async () => {
  const t = setup()
  t.host.startResult = false
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
  assert.ok(!t.states.some((s) => s.phase === 'error'))
})

test('las peticiones repetidas se agrupan en una sola apertura', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  t.monitor.setWanted(true)
  t.monitor.setWanted(true)
  await flush()
  assert.equal(t.starts().length, 1)
})

test('cambiar de fuente o de motores reabre la escucha con lo nuevo', async () => {
  const t = setup()
  t.host.sources = { supported: true, apps: [{ id: 41, name: 'Firefox.exe' }] }
  t.monitor.setWanted(true)
  await flush()

  t.settings.change({ audioSource: FIREFOX })
  await flush()
  assert.deepEqual(t.starts().at(-1), { type: 'startAudioMonitor', source: { kind: 'app', id: 41, name: 'Firefox.exe' } })

  t.settings.change({ engines: 'fake' })
  await flush()
  assert.equal(t.starts().length, 3, 'otro conjunto de motores también cuenta')
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
})

test('ajustes que no afectan a la escucha no la tocan', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()
  const before = t.sent.length
  t.settings.change({})
  t.settings.change({})
  await flush()
  assert.equal(t.sent.length, before)
})

test('una aplicación que no suena deja la escucha esperando y empieza sola cuando suena', async () => {
  const t = setup({ audioSource: FIREFOX })
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'waiting', program: 'firefox.exe' })
  assert.equal(t.starts().length, 0)
  assert.equal(t.timers.count, 1, 'vuelve a mirar en unos segundos')

  t.timers.fire()
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'waiting', program: 'firefox.exe' }, 'sigue sin sonar')
  assert.equal(t.timers.count, 1)

  t.host.sources = { supported: true, apps: [{ id: 9, name: 'firefox.exe' }] }
  t.timers.fire()
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
  assert.deepEqual(t.starts(), [{ type: 'startAudioMonitor', source: { kind: 'app', id: 9, name: 'firefox.exe' } }])
})

test('la aplicación que se cierra pasa a espera y la que vuelve con otro proceso se reabre', async () => {
  const t = setup({ audioSource: FIREFOX })
  t.host.sources = { supported: true, apps: [{ id: 9, name: 'firefox.exe' }] }
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'listening' })

  t.timers.fire() // sigue sonando con el mismo proceso: no se reabre
  await flush()
  assert.equal(t.starts().length, 1)
  assert.equal(t.timers.count, 1)

  t.host.sources = { supported: true, apps: [] }
  t.timers.fire()
  await flush()
  assert.equal(t.stops().length, 1)
  assert.deepEqual(t.monitor.state, { phase: 'waiting', program: 'firefox.exe' })

  t.host.sources = { supported: true, apps: [{ id: 77, name: 'firefox.exe' }] }
  t.timers.fire()
  await flush()
  assert.deepEqual(t.starts().at(-1), { type: 'startAudioMonitor', source: { kind: 'app', id: 77, name: 'firefox.exe' } })
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
})

test('una plataforma sin captura por aplicación lo explica y no abre nada', async () => {
  const t = setup({ audioSource: FIREFOX })
  t.host.sources = { supported: false, reason: 'solo Windows 10 2004 o posterior' }
  t.monitor.setWanted(true)
  await flush()
  const state = t.monitor.state
  assert.equal(state.phase, 'error')
  assert.match((state as { reason: string }).reason, /Todo el sistema/)
  assert.match((state as { reason: string }).reason, /Windows 10 2004/)
  assert.equal(t.starts().length, 0)
})

test('un fallo al abrir la fuente se muestra, no se repite solo y se reintenta al volver a verse Inicio', async () => {
  const t = setup()
  t.host.failStart = new Error('capture error: no loopback device')
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'error', reason: 'capture error: no loopback device' })
  assert.equal(t.starts().length, 1)

  // Ajustes sin relación con la escucha (arrastrar un control, por ejemplo) no reintentan.
  t.settings.change({})
  t.settings.change({})
  await flush()
  assert.equal(t.starts().length, 1, 'no hay bucle de reintentos')

  t.host.failStart = null
  t.monitor.setWanted(false)
  t.monitor.setWanted(true)
  await flush()
  assert.equal(t.starts().length, 2)
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
})

test('un fallo del motor que se reinicia no se muestra como error de la fuente', async () => {
  const t = setup()
  t.host.failStart = new Error('engine process exited')
  t.monitor.setWanted(true)
  await flush()
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
  assert.ok(!t.states.some((s) => s.phase === 'error'))
})

test('si el motor se cae vuelve a abrir la escucha cuando está listo', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()
  t.host.emit('crashed', { exitCode: 1, restartInMs: 250 })
  assert.deepEqual(t.monitor.state, { phase: 'idle' })

  t.host.emit('ready')
  await flush()
  assert.equal(t.starts().length, 2)
  assert.deepEqual(t.monitor.state, { phase: 'listening' })
})

test('tras dispose no se manda nada más y se cierra lo abierto', async () => {
  const t = setup()
  t.monitor.setWanted(true)
  await flush()
  t.monitor.dispose()
  await flush()
  assert.equal(t.stops().length, 1)
  const before = t.sent.length
  t.monitor.setWanted(true)
  t.sessionEnds()
  t.settings.change({ mode: 'audio' })
  await flush()
  assert.equal(t.sent.length, before)
})

// ------------------------------------------------------------------------------------------ IPC

function ipcSetup(windowSender: unknown = 'win') {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>()
  const ipc: IpcRegistry = { handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) }
  const t = setup()
  const sent: [string, unknown][] = []
  const gone: (() => void)[] = []
  const dispose = registerMonitorIpc({
    handle: guardedHandle(ipc, () => windowSender),
    monitor: t.monitor,
    toWindow: (channel, payload) => void sent.push([channel, payload]),
    onWindowGone: (callback) => void gone.push(callback),
  })
  const invoke = (sender: unknown, ...args: unknown[]) => handlers.get(Channel.audioWatch)!({ sender }, ...args)
  return { t, sent, gone, dispose, invoke }
}

test('IPC: declarar Inicio a la vista abre la escucha y el estado llega a la ventana', async () => {
  const { t, sent, invoke } = ipcSetup()
  await invoke('win', true)
  await flush()
  assert.equal(t.starts().length, 1)
  assert.deepEqual(sent.map(([, state]) => state), [{ phase: 'starting' }, { phase: 'listening' }])
  assert.ok(sent.every(([channel]) => channel === Channel.audioMonitorState))
})

test('IPC: cualquier valor que no sea exactamente true se toma como «no está a la vista»', async () => {
  const { t, invoke } = ipcSetup()
  for (const value of ['true', 1, null, undefined, {}]) await invoke('win', value)
  await flush()
  assert.equal(t.sent.length, 0)
})

test('IPC: un remitente ajeno se rechaza y no toca nada', async () => {
  const { t, invoke } = ipcSetup()
  assert.throws(() => invoke('intruso', true), /unauthorized sender/)
  await flush()
  assert.equal(t.sent.length, 0)
  const closed = ipcSetup(null)
  assert.throws(() => closed.invoke('win', true), /unauthorized sender/, 'sin ventana nada se atiende')
})

test('IPC: si la ventana desaparece la escucha se apaga aunque ella no avise', async () => {
  const { t, gone, invoke } = ipcSetup()
  await invoke('win', true)
  await flush()
  assert.equal(gone.length, 1)
  gone[0]!() // la ventana se cerró
  await flush()
  assert.equal(t.stops().length, 1)
  assert.deepEqual(t.monitor.state, { phase: 'idle' })
})

test('IPC: al deshacer el registro el estado deja de enviarse', async () => {
  const { t, sent, dispose, invoke } = ipcSetup()
  dispose()
  await invoke('win', true)
  await flush()
  assert.equal(t.starts().length, 1)
  assert.deepEqual(sent, [])
})
