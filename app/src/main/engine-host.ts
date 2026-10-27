// Supervisor del proceso utilitario que aloja el motor nativo.
//
// Si el proceso termina de forma inesperada (por ejemplo un pánico de Rust), main lo detecta,
// emite `crashed` (solo con el código de salida, sin contenido) y lo reinicia con espera
// exponencial. El proceso principal no se ve afectado.

import { EventEmitter } from 'node:events'

import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'

import type { Command, CommandResult, EngineEvent, WorkerMessage } from '../shared/protocol.ts'

export interface EngineHostOptions {
  /** Ruta del script del proceso utilitario. */
  workerPath: string
  /** Espera antes del primer reinicio; se duplica en cada caída seguida. */
  restartBaseMs?: number
  restartMaxMs?: number
  /** Si el proceso vivió al menos esto, la siguiente caída vuelve a empezar desde la base. */
  stableMs?: number
  /** Tiempo máximo para que el motor responda a una orden (las descargas no tienen límite). */
  requestTimeoutMs?: number
}

export interface CrashInfo {
  exitCode: number
  /** Espera antes de reiniciar el proceso del motor. */
  restartInMs: number
}

interface HostEvents {
  ready: []
  event: [EngineEvent]
  crashed: [CrashInfo]
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

/** Órdenes que pueden tardar minutos y no deben cortarse por tiempo. */
const UNBOUNDED: ReadonlySet<Command['type']> = new Set(['downloadModels'])

export class EngineHost extends EventEmitter<HostEvents> {
  private readonly options: EngineHostOptions
  private readonly restartBaseMs: number
  private readonly restartMaxMs: number
  private readonly stableMs: number
  private readonly requestTimeoutMs: number

  private child: UtilityProcess | null = null
  private ready = false
  private stopping = false
  private startedAt = 0
  private attempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(options: EngineHostOptions) {
    super()
    this.options = options
    this.restartBaseMs = options.restartBaseMs ?? 250
    this.restartMaxMs = options.restartMaxMs ?? 5000
    this.stableMs = options.stableMs ?? 10_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get isReady(): boolean {
    return this.ready
  }

  start(): void {
    if (this.child) return
    this.stopping = false
    this.spawn()
  }

  /** Resuelve cuando el motor está listo para recibir órdenes. */
  whenReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('ready', onReady)
        reject(new Error('timed out waiting for the engine to be ready'))
      }, timeoutMs)
      const onReady = (): void => {
        clearTimeout(timer)
        resolve()
      }
      this.once('ready', onReady)
    })
  }

  /** Envía una orden y espera su resultado (p. ej. el estado de los modelos). */
  send<C extends Command>(command: C): Promise<CommandResult<C>> {
    const child = this.child
    if (!child || !this.ready) return Promise.reject(new Error('engine is not ready'))
    const id = this.nextId++
    return new Promise<CommandResult<C>>((resolve, reject) => {
      const timer = UNBOUNDED.has(command.type)
        ? null
        : setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`engine did not answer "${command.type}" in time`))
          }, this.requestTimeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      child.postMessage({ ...command, id })
    })
  }

  /** Termina el proceso del motor de forma abrupta. Pensado para pruebas de caída. */
  kill(): void {
    this.child?.kill()
  }

  /** Apagado deliberado: no se reinicia. */
  shutdown(): void {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.child?.kill()
  }

  private spawn(): void {
    const child = utilityProcess.fork(this.options.workerPath, [], {
      serviceName: 'translate-engine',
    })
    this.startedAt = Date.now()
    this.child = child
    child.on('message', (message: WorkerMessage) => this.onMessage(message))
    child.on('exit', (code) => this.onExit(child, code))
  }

  private onMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'ready':
        this.ready = true
        this.emit('ready')
        return
      case 'reply': {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (pending.timer) clearTimeout(pending.timer)
        if (message.error === undefined) pending.resolve(message.value)
        else pending.reject(new Error(message.error))
        return
      }
      case 'event': {
        const { type: _type, ...event } = message
        this.emit('event', event as EngineEvent)
        return
      }
    }
  }

  private onExit(child: UtilityProcess, exitCode: number): void {
    if (this.child !== child) return // proceso viejo, ya reemplazado
    this.child = null
    this.ready = false
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new Error('engine process exited'))
    }
    this.pending.clear()

    if (this.stopping) return // apagado deliberado: no es una caída
    if (Date.now() - this.startedAt >= this.stableMs) this.attempts = 0
    const delay = Math.min(this.restartBaseMs * 2 ** this.attempts, this.restartMaxMs)
    this.attempts += 1
    this.emit('crashed', { exitCode, restartInMs: delay })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) this.spawn()
    }, delay)
  }
}
