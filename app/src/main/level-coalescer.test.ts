import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AudioLevel } from '../shared/ipc.ts'
import { LevelCoalescer } from './level-coalescer.ts'
import type { LevelClock } from './level-coalescer.ts'

function fakeClock() {
  let now = 1000
  let timers: { at: number; callback: () => void; id: number }[] = []
  let nextId = 1
  const clock: LevelClock = {
    now: () => now,
    setTimer: (callback, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, callback, id })
      return id
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t.id !== handle)
    },
  }
  const advance = (ms: number): void => {
    const target = now + ms
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers = timers.filter((t) => t !== due)
      now = due.at
      due.callback()
    }
    now = target
  }
  return { clock, advance }
}

const lv = (rms: number): AudioLevel => ({ rms, peak: rms })

test('el primer nivel pasa de inmediato y el resto se agrupa conservando el último', () => {
  const { clock, advance } = fakeClock()
  const out: AudioLevel[] = []
  const c = new LevelCoalescer((l) => out.push(l), 15, clock)
  c.push(lv(0.1))
  assert.deepEqual(out, [lv(0.1)])
  advance(10)
  c.push(lv(0.2))
  c.push(lv(0.3))
  c.push(lv(0.4))
  assert.equal(out.length, 1, 'no se reenvía dentro del intervalo')
  advance(100)
  assert.deepEqual(out, [lv(0.1), lv(0.4)], 'solo el último valor')
})

test('con 10 niveles por segundo durante 3 s salen como mucho 15 por segundo', () => {
  const { clock, advance } = fakeClock()
  let count = 0
  const c = new LevelCoalescer(() => count++, 15, clock)
  for (let i = 0; i < 30; i++) {
    c.push(lv(i / 100))
    advance(33) // 30 por segundo de entrada
  }
  assert.ok(count <= 15 * 1.0 + 1, `salieron ${count}`)
  assert.ok(count >= 10)
})

test('reset descarta lo pendiente', () => {
  const { clock, advance } = fakeClock()
  const out: AudioLevel[] = []
  const c = new LevelCoalescer((l) => out.push(l), 15, clock)
  c.push(lv(0.1))
  c.push(lv(0.2))
  c.reset()
  advance(500)
  assert.equal(out.length, 1)
  c.push(lv(0.3))
  assert.equal(out.length, 2, 'tras el reset vuelve a pasar')
})
