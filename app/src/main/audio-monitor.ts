// Escucha previa del nivel de audio: mueve la barra de Inicio antes de iniciar ninguna sesión.
//
// La interfaz solo declara si Inicio está a la vista (`setWanted`). Aquí se decide si de verdad toca escuchar: sin
// sesión (`controller.state.running` falso), con un modo que use el audio y con la ventana viva. Todo lo que puede
// cambiar la respuesta (ajustes, sesión, caída o reinicio del motor, el temporizador de la aplicación elegida)
// vuelve a la misma función, que deja el motor como toca; las órdenes al motor se hacen de una en una y las
// peticiones que llegan mientras se trabaja se agrupan en una sola vuelta.
//
// El motor garantiza el resto: una sesión detiene la escucha antes de abrir su captura y la escucha no arranca con una
// sesión en marcha, así que un cruce de órdenes nunca deja dos capturas sobre el mismo dispositivo.

import { EventEmitter } from 'node:events'

import { Channel } from '../shared/ipc.ts'
import type { AudioSourceChoice, AudioSourcesInfo, MonitorState } from '../shared/ipc.ts'
import type { AudioSourceRequest, Command } from '../shared/protocol.ts'
import type { Settings } from '../shared/settings.ts'
import type { ControllerTimers } from './app-controller.ts'
import type { guardedHandle } from './session-ipc.ts'

/** Cada cuánto se vuelve a mirar si la aplicación elegida suena (o sigue sonando). */
export const MONITOR_RECHECK_MS = 2000

const realTimers: ControllerTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

/** Fallos que no son de la fuente sino del motor, que se reinicia solo: se reintenta cuando vuelve. */
const ENGINE_GONE = /engine process exited|engine is not ready|timed out waiting for the engine|did not answer/

export interface MonitorDeps {
  host: {
    send(command: Command): Promise<unknown>
    on(event: 'ready' | 'crashed', listener: () => void): unknown
  }
  controller: {
    readonly state: { readonly running: boolean }
    on(event: 'state', listener: () => void): unknown
  }
  settings: {
    get(): Pick<Settings, 'mode' | 'engines' | 'audioSource'>
    onChange(listener: () => void): () => void
  }
  /** Deja el motor configurado con los ajustes actuales (los motores reales o los de demostración). */
  prepare: () => Promise<void>
  timers?: ControllerTimers
  /** Espera entre comprobaciones de la aplicación elegida. */
  recheckMs?: number
}

interface Wanted {
  /** Identifica lo que se quiere escuchar: motores y fuente. Si cambia, hay que reabrir. */
  key: string
  choice: AudioSourceChoice
}

type Resolved = { kind: 'ok'; source: AudioSourceRequest } | { kind: 'waiting'; program: string } | { kind: 'unsupported'; reason: string }

interface ScheduleFlags {
  /** Algo invita a volver a intentar lo que falló (Inicio vuelve a verse, el motor volvió...). */
  retry?: boolean
  /** Toca comprobar si la aplicación elegida sigue (o ya empieza a) sonar. */
  recheck?: boolean
}

export class AudioMonitor extends EventEmitter<{ state: [MonitorState] }> {
  private readonly deps: MonitorDeps
  private readonly timers: ControllerTimers
  private readonly recheckMs: number
  private readonly offSettings: () => void
  private current: MonitorState = { phase: 'idle' }
  private wanted = false
  /** Lo que el motor tiene abierto ahora, según este servicio. */
  private applied: { key: string; appId: number | null } | null = null
  /** Fuente para la que ya hay un resultado estable (escuchando, esperando o con error): no se repite sin motivo. */
  private settledKey: string | null = null
  private retry = false
  private recheck = false
  private dirty = false
  private busy = false
  private disposed = false
  private timer: unknown = null

  constructor(deps: MonitorDeps) {
    super()
    this.deps = deps
    this.timers = deps.timers ?? realTimers
    this.recheckMs = deps.recheckMs ?? MONITOR_RECHECK_MS
    deps.controller.on('state', () => this.schedule())
    this.offSettings = deps.settings.onChange(() => this.schedule())
    // El motor reiniciado vuelve sin nada abierto: se reabre cuando está listo.
    deps.host.on('crashed', () => {
      this.applied = null
      this.settledKey = null
      this.clearTimer()
      this.setState({ phase: 'idle' })
    })
    deps.host.on('ready', () => this.schedule({ retry: true }))
  }

  get state(): MonitorState {
    return this.current
  }

  /** La interfaz declara si Inicio está a la vista; con `true` se reintenta lo que hubiera fallado. */
  setWanted(on: boolean): void {
    this.wanted = on
    this.schedule(on ? { retry: true } : {})
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offSettings()
    void this.release()
  }

  // ------------------------------------------------------------------------------------- bucle

  private schedule(flags: ScheduleFlags = {}): void {
    if (this.disposed) return
    if (flags.retry) this.retry = true
    if (flags.recheck) this.recheck = true
    this.dirty = true
    if (!this.busy) void this.loop()
  }

  private async loop(): Promise<void> {
    this.busy = true
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        await this.step()
      }
    } finally {
      this.busy = false
    }
  }

  /** Qué toca escuchar ahora, o `null` si no toca escuchar nada. */
  private compute(): Wanted | null {
    if (this.disposed || !this.wanted) return null
    if (this.deps.controller.state.running) return null
    const { mode, engines, audioSource } = this.deps.settings.get()
    if (mode === 'text') return null
    return { key: `${engines}|${audioSource.kind === 'app' ? `app:${audioSource.program}` : 'system'}`, choice: audioSource }
  }

  private async step(): Promise<void> {
    const retry = this.retry
    const recheck = this.recheck
    this.retry = false
    this.recheck = false

    const want = this.compute()
    if (want === null) {
      this.settledKey = null
      await this.release()
      this.setState({ phase: 'idle' })
      return
    }
    if (this.settledKey === want.key && !retry && !recheck) return

    // Con la fuente ya abierta solo se comprueba que la aplicación siga sonando: no se vuelve a mostrar «abriendo».
    const reopening = this.applied !== null && this.applied.key === want.key
    if (!reopening) this.setState({ phase: 'starting' })
    try {
      await this.deps.prepare()
      const resolved = await this.resolve(want.choice)
      if (this.dirty) {
        // Cambió algo mientras se miraba: la vuelta siguiente lo recoge, sin perder los motivos de reintento.
        this.retry ||= retry
        this.recheck ||= recheck
        return
      }
      if (resolved.kind === 'unsupported') {
        await this.release()
        this.fail(want.key, `Esta plataforma no permite capturar el audio de una aplicación (${resolved.reason}); elige «Todo el sistema»`)
        return
      }
      if (resolved.kind === 'waiting') {
        await this.release()
        this.settledKey = want.key
        this.setState({ phase: 'waiting', program: resolved.program })
        this.arm(want.choice)
        return
      }
      const appId = resolved.source.kind === 'app' ? resolved.source.id : null
      if (reopening && this.applied?.appId === appId) {
        this.arm(want.choice)
        return
      }
      const started = await this.deps.host.send({ type: 'startAudioMonitor', source: resolved.source })
      if (started === true) {
        this.applied = { key: want.key, appId }
        this.settledKey = want.key
        this.setState({ phase: 'listening' })
        this.arm(want.choice)
      } else {
        // Una sesión ocupa el motor: la escucha cede y volverá cuando termine.
        this.applied = null
        this.settledKey = null
        this.setState({ phase: 'idle' })
      }
    } catch (error) {
      this.applied = null
      const reason = error instanceof Error ? error.message : String(error)
      if (ENGINE_GONE.test(reason)) {
        this.settledKey = null
        this.setState({ phase: 'idle' })
        return
      }
      this.fail(want.key, reason)
    }
  }

  /** Busca entre las aplicaciones que suenan la elegida (por nombre de programa), como el controlador. */
  private async resolve(choice: AudioSourceChoice): Promise<Resolved> {
    if (choice.kind === 'system') return { kind: 'ok', source: { kind: 'system' } }
    const info = (await this.deps.host.send({ type: 'listAudioSources' })) as AudioSourcesInfo
    if (!info.supported) return { kind: 'unsupported', reason: info.reason }
    const wanted = choice.program.toLowerCase()
    const app = info.apps.find((a) => a.name.toLowerCase() === wanted)
    return app ? { kind: 'ok', source: { kind: 'app', id: app.id, name: app.name } } : { kind: 'waiting', program: choice.program }
  }

  /** Cierra lo que el motor tenga abierto. */
  private async release(): Promise<void> {
    this.clearTimer()
    const open = this.applied !== null
    this.applied = null
    if (open) await this.deps.host.send({ type: 'stopAudioMonitor' }).catch(() => undefined)
  }

  /** Un fallo de la fuente: se muestra y no se repite hasta que haya un motivo para intentarlo de nuevo. */
  private fail(key: string, reason: string): void {
    this.settledKey = key
    this.setState({ phase: 'error', reason })
  }

  /** Con una aplicación como fuente, vuelve a mirar cada pocos segundos si suena (o si dejó de sonar). */
  private arm(choice: AudioSourceChoice): void {
    this.clearTimer()
    if (choice.kind !== 'app' || this.disposed) return
    this.timer = this.timers.setTimer(() => {
      this.timer = null
      this.schedule({ recheck: true })
    }, this.recheckMs)
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimer(this.timer)
    this.timer = null
  }

  private setState(next: MonitorState): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return
    this.current = next
    this.emit('state', next)
  }
}

// ---------------------------------------------------------------------------------------- IPC

export interface MonitorIpcDeps {
  handle: ReturnType<typeof guardedHandle>
  monitor: Pick<AudioMonitor, 'state' | 'setWanted' | 'on' | 'off'>
  toWindow(channel: string, payload: unknown): void
  /** Avisa cuando la ventana de Ajustes desaparece (pueden pedirlo varias veces; debe registrarse una sola). */
  onWindowGone(callback: () => void): void
}

export const MONITOR_CHANNELS = [Channel.audioWatch] as const

/** Registra el canal de la escucha previa y reenvía su estado a la ventana. Devuelve cómo deshacerlo. */
export function registerMonitorIpc({ handle, monitor, toWindow, onWindowGone }: MonitorIpcDeps): () => void {
  handle(Channel.audioWatch, (on: unknown) => {
    const wanted = on === true
    // Una ventana cerrada no puede avisar de que Inicio dejó de verse: se apaga la escucha por ella.
    if (wanted) onWindowGone(() => monitor.setWanted(false))
    monitor.setWanted(wanted)
    return monitor.state
  })
  const onState = (state: MonitorState): void => toWindow(Channel.audioMonitorState, state)
  monitor.on('state', onState)
  return () => {
    monitor.off('state', onState)
  }
}
