import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import type { AppState, OverlayText } from '../shared/ipc.ts'
import { bindTranscript } from './transcript-session.ts'

const idle: AppState = { running: false, paused: false, mode: null, phase: 'idle' }
const running: AppState = { running: true, paused: false, mode: 'audio', phase: 'running' }
const paused: AppState = { ...running, paused: true, phase: 'paused' }
const text: OverlayText = { original: 'Hi', lang: 'en', translations: [], final: true }

function setup(initial = idle) {
  const controller = Object.assign(new EventEmitter<{ state: [AppState]; text: [OverlayText] }>(), { state: initial })
  const calls: string[] = []
  const unbind = bindTranscript(controller, {
    sessionStarted: () => calls.push('start'),
    sessionEnded: async () => {
      calls.push('end')
    },
    line: (t) => calls.push(`line:${t.original}`),
  })
  return { controller, calls, unbind }
}

test('una sesión empieza al pasar a running y termina al detenerse; pausar no la corta', () => {
  const { controller, calls } = setup()
  controller.emit('state', { ...running, phase: 'starting' })
  controller.emit('state', running)
  controller.emit('text', text)
  controller.emit('state', paused)
  controller.emit('state', running)
  controller.emit('state', idle)
  assert.deepEqual(calls, ['start', 'line:Hi', 'end'])
})

test('si ya había una sesión al conectar, empieza enseguida', () => {
  const { calls } = setup(running)
  assert.deepEqual(calls, ['start'])
})

test('desconectar deja de reenviar eventos', () => {
  const { controller, calls, unbind } = setup()
  unbind()
  controller.emit('state', running)
  controller.emit('text', text)
  assert.deepEqual(calls, [])
})
