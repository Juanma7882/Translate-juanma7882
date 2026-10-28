// Agrupa los niveles de audio (hasta 10 por segundo por captura) para no saturar el IPC: deja pasar como
// mucho `maxHz` por segundo y de lo que llegue entre medias solo conserva el último. Solo maneja números.

import type { AudioLevel } from '../shared/ipc.ts'

export interface LevelClock {
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export const realClock: LevelClock = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

export class LevelCoalescer {
  private readonly intervalMs: number
  private lastEmit = Number.NEGATIVE_INFINITY
  private pending: AudioLevel | null = null
  private timer: unknown = null

  private readonly emit: (level: AudioLevel) => void
  private readonly clock: LevelClock

  constructor(emit: (level: AudioLevel) => void, maxHz = 15, clock: LevelClock = realClock) {
    this.emit = emit
    this.clock = clock
    this.intervalMs = 1000 / maxHz
  }

  push(level: AudioLevel): void {
    const wait = this.lastEmit + this.intervalMs - this.clock.now()
    if (wait <= 0 && this.timer === null) {
      this.send(level)
      return
    }
    this.pending = level
    if (this.timer === null) this.timer = this.clock.setTimer(() => this.flush(), Math.max(wait, 0))
  }

  /** Descarta lo pendiente (la captura terminó o el motor se reinició). */
  reset(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer)
    this.timer = null
    this.pending = null
  }

  private flush(): void {
    this.timer = null
    const level = this.pending
    this.pending = null
    if (level) this.send(level)
  }

  private send(level: AudioLevel): void {
    this.lastEmit = this.clock.now()
    this.emit(level)
  }
}
