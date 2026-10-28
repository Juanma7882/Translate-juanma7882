import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runCommand } from './dispatch.ts'
import type { NativeEngine } from './dispatch.ts'

function fake(extra: Record<string, unknown> = {}) {
  const calls: unknown[][] = []
  const engine = {
    startAudioSubtitles: (...args: unknown[]) => void calls.push(args),
    ...extra,
  } as unknown as NativeEngine
  return { engine, calls }
}

test('startAudio pasa la fuente al motor y sin fuente sigue siendo todo el sistema', async () => {
  const { engine, calls } = fake()
  await runCommand(engine, { id: 1, type: 'startAudio', from: 'en', to: ['es'], source: { kind: 'app', id: 7, name: 'firefox.exe' } })
  await runCommand(engine, { id: 2, type: 'startAudio', from: 'en', to: ['es'] })
  assert.deepEqual(calls, [['en', ['es'], { kind: 'app', id: 7, name: 'firefox.exe' }], ['en', ['es'], undefined]])
})

test('listAudioSources y voiceThreshold devuelven lo del motor', async () => {
  const { engine } = fake({ listAudioSources: () => ({ supported: true, apps: [{ id: 1, name: 'a.exe' }] }), audioVoiceThreshold: () => 0.02 })
  assert.deepEqual(await runCommand(engine, { id: 1, type: 'listAudioSources' }), { supported: true, apps: [{ id: 1, name: 'a.exe' }] })
  assert.equal(await runCommand(engine, { id: 2, type: 'voiceThreshold' }), 0.02)
})

test('un motor sin audio por aplicación se declara no compatible y no inventa el umbral', async () => {
  const { engine } = fake()
  const info = (await runCommand(engine, { id: 1, type: 'listAudioSources' })) as { supported: boolean }
  assert.equal(info.supported, false)
  await assert.rejects(runCommand(engine, { id: 2, type: 'voiceThreshold' }))
})
