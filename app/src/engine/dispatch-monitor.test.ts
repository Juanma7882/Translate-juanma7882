// Reparto de las órdenes de la escucha previa del nivel hacia el módulo nativo.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runCommand } from './dispatch.ts'
import type { NativeEngine } from './dispatch.ts'

function fake(extra: Record<string, unknown> = {}) {
  const calls: string[] = []
  const engine = {
    startAudioMonitor: (...args: unknown[]) => {
      calls.push(`start ${JSON.stringify(args)}`)
      return true
    },
    stopAudioMonitor: () => void calls.push('stop'),
    ...extra,
  } as unknown as NativeEngine
  return { engine, calls }
}

test('startAudioMonitor pasa la fuente y devuelve si la escucha quedó abierta', async () => {
  const { engine, calls } = fake()
  assert.equal(await runCommand(engine, { id: 1, type: 'startAudioMonitor', source: { kind: 'app', id: 7, name: 'firefox.exe' } }), true)
  assert.equal(await runCommand(engine, { id: 2, type: 'startAudioMonitor' }), true)
  // Sin fuente se pasa `undefined` (JSON lo escribe como null): el motor lo toma como «todo el sistema».
  assert.deepEqual(calls, ['start [{"kind":"app","id":7,"name":"firefox.exe"}]', 'start [null]'])
})

test('con una sesión en marcha el motor devuelve false y se transmite tal cual', async () => {
  const { engine } = fake({ startAudioMonitor: () => false })
  assert.equal(await runCommand(engine, { id: 1, type: 'startAudioMonitor' }), false)
})

test('stopAudioMonitor llega al motor y no devuelve nada', async () => {
  const { engine, calls } = fake()
  assert.equal(await runCommand(engine, { id: 1, type: 'stopAudioMonitor' }), undefined)
  assert.deepEqual(calls, ['stop'])
})

test('un motor sin escucha previa rechaza abrirla y tolera cerrarla', async () => {
  const engine = {} as unknown as NativeEngine
  await assert.rejects(runCommand(engine, { id: 1, type: 'startAudioMonitor' }), /cannot preview/)
  assert.equal(await runCommand(engine, { id: 2, type: 'stopAudioMonitor' }), undefined)
})

test('un fallo del motor al abrir la fuente llega como rechazo con su motivo', async () => {
  const { engine } = fake({
    startAudioMonitor: () => {
      throw new Error('capture error: no loopback device')
    },
  })
  await assert.rejects(runCommand(engine, { id: 1, type: 'startAudioMonitor' }), /no loopback device/)
})
