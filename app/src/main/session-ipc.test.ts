import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { Channel } from '../shared/ipc.ts'
import { guardedHandle, registerSessionIpc, SESSION_CHANNELS } from './session-ipc.ts'
import type { IpcRegistry, SessionControls, SessionEngine } from './session-ipc.ts'

type Listener = (event: { sender: unknown }, ...args: unknown[]) => unknown

function setup(windowSender: unknown = 'win') {
  const handlers = new Map<string, Listener>()
  const ipc: IpcRegistry = { handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) }
  const calls: string[] = []
  const controller = {
    state: { running: false, paused: false, mode: null, phase: 'idle' },
    startSession: () => Promise.resolve(void calls.push('start')),
    pause: () => Promise.resolve(void calls.push('pause')),
    resume: () => Promise.resolve(void calls.push('resume')),
    restart: () => Promise.resolve(void calls.push('restart')),
    stop: () => Promise.resolve(void calls.push('stop')),
    chooseRegion: () => Promise.resolve(void calls.push('region')).then(() => chosen),
    showRegion: () => Promise.resolve(void calls.push('show')).then(() => chosen),
  } as SessionControls
  const emitter = new EventEmitter()
  let reply: unknown = { supported: true, apps: [{ id: 1, name: 'a.exe' }] }
  let fail = false
  let chosen = true
  const host = {
    send: (c: { type: string }) => (fail ? Promise.reject(new Error('not ready')) : Promise.resolve(c.type === 'voiceThreshold' ? 0.01 : reply)),
    on: (e: string, l: (x: unknown) => void) => emitter.on(e, l),
    off: (e: string, l: (x: unknown) => void) => emitter.off(e, l),
  } as unknown as SessionEngine
  const sent: [string, unknown][] = []
  const dispose = registerSessionIpc({
    handle: guardedHandle(ipc, () => windowSender),
    controller,
    host,
    toWindow: (c, p) => void sent.push([c, p]),
  })
  const invoke = (channel: string, sender: unknown = 'win', ...args: unknown[]) => handlers.get(channel)!({ sender }, ...args)
  return { handlers, calls, emitter, sent, invoke, dispose, setFail: (v: boolean) => (fail = v), setReply: (v: unknown) => (reply = v), setChosen: (v: boolean) => (chosen = v) }
}

test('registra todos los canales de sesión y cada uno llama a su acción', async () => {
  const { handlers, calls, invoke } = setup()
  for (const channel of SESSION_CHANNELS) assert.ok(handlers.has(channel), channel)
  await invoke(Channel.sessionStart)
  await invoke(Channel.sessionPause)
  await invoke(Channel.sessionResume)
  await invoke(Channel.sessionRestart)
  await invoke(Channel.sessionStop)
  assert.deepEqual(calls, ['start', 'pause', 'resume', 'restart', 'stop'])
})

test('el guardián rechaza a cualquier remitente que no sea la ventana', () => {
  const { calls, invoke } = setup()
  for (const channel of SESSION_CHANNELS) assert.throws(() => invoke(channel, 'intruso'), /unauthorized sender/, channel)
  assert.deepEqual(calls, [])
  const closed = setup(null)
  assert.throws(() => closed.invoke(Channel.sessionStart, 'win'), /unauthorized sender/, 'sin ventana nada se atiende')
})

test('la lista de fuentes y el umbral salen del motor; si no contesta la lista queda vacía', async () => {
  const { invoke, setFail, setReply } = setup()
  assert.deepEqual(await invoke(Channel.audioSources), { supported: true, apps: [{ id: 1, name: 'a.exe' }] })
  setReply({ supported: false, reason: 'no' })
  assert.deepEqual(await invoke(Channel.audioSources), { supported: false, reason: 'no' })
  assert.equal(await invoke(Channel.audioVoiceThreshold), 0.01)
  setFail(true)
  assert.deepEqual(await invoke(Channel.audioSources), { supported: true, apps: [] })
})

test('los niveles ya agrupados se reenvían a la ventana y solo ellos; al retirar deja de reenviar', () => {
  const { emitter, sent, dispose } = setup()
  emitter.emit('event', { name: 'audioLevel', payload: { rms: 0.2, peak: 0.5 } })
  emitter.emit('event', { name: 'translation', payload: { original: 'secreto', translated: 'x' } })
  assert.deepEqual(sent, [[Channel.audioLevel, { rms: 0.2, peak: 0.5 }]])
  dispose()
  emitter.emit('event', { name: 'audioLevel', payload: { rms: 0.3, peak: 0.3 } })
  assert.equal(sent.length, 1)
})

test('«Cambiar región» delega en el controlador y devuelve si se eligió (cancelar no es un error)', async () => {
  const { calls, invoke, setChosen } = setup()
  assert.equal(await invoke(Channel.sessionChooseRegion), true)
  setChosen(false)
  assert.equal(await invoke(Channel.sessionChooseRegion), false)
  assert.deepEqual(calls, ['region', 'region'])
})

test('la ventana puede pedir el estado actual de la sesión al abrirse', async () => {
  const { invoke } = setup()
  assert.deepEqual(await invoke(Channel.sessionState), { running: false, paused: false, mode: null, phase: 'idle' })
})
