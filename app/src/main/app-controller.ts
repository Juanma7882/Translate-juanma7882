// Controlador de la aplicación: une selector de región, ajustes, motor y overlay.
//
// El modo (`auto`, `text`, `audio`) sale de los ajustes y decide la orden al motor: automático y
// solo texto usan `startRegion` (con o sin fallback, según las opciones del motor); solo audio usa
// `startAudio` y no necesita región. Cambiar el modo o la fuente de audio con una sesión en marcha la reinicia.
//
// Todas las órdenes de sesión (iniciar, pausar, reanudar, reiniciar, detener) pasan por una cola que las
// ejecuta de una en una, así nunca se pisan; cada una comprueba el estado cuando le llega el turno, de modo
// que repetirlas es seguro. Con la fuente "aplicación" la sesión espera (fase `waiting`) a que suene el programa.

import { EventEmitter } from 'node:events'

import { Channel } from '../shared/ipc.ts'
import type { AppState, AudioSourceChoice, Notice, OverlayText, SessionPhase } from '../shared/ipc.ts'
import { initialActive, needsRegion, nextMode } from '../shared/mode.ts'
import type { Mode } from '../shared/mode.ts'
import type { AudioSourceRequest, EngineEvent } from '../shared/protocol.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { EngineHost } from './engine-host.ts'
import { noticeForCrash, noticeForEngineError, noticeForStartFailure } from './notices.ts'
import type { DisplaySource } from './overlay-picker.ts'
import { OverlayPicker } from './overlay-picker.ts'
import type { RegionPicker } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** Temporizador inyectable (las pruebas lo sustituyen por uno manual). */
export interface ControllerTimers {
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

const realTimers: ControllerTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

/** Cada cuánto se vuelve a mirar si la aplicación elegida ya suena. */
export const WAIT_RETRY_MS = 2000

export interface ControllerDeps {
  host: EngineHost
  windows: WindowManager
  settings: SettingsStore
  picker: RegionPicker
  displays: DisplaySource
  /** Configura el motor con los ajustes actuales (lo hace al arrancar una traducción). */
  configure: () => Promise<void>
  timers?: ControllerTimers
  /** Espera entre intentos mientras se aguarda a la aplicación elegida. */
  waitRetryMs?: number
}

interface ControllerEvents {
  state: [AppState]
  notice: [Notice]
  /** Texto de una traducción o subtítulo ya preparado para mostrar. */
  text: [OverlayText]
  /** La región se quedó sin texto: el overlay puede retirar la traducción. */
  clearText: []
}

const IDLE: AppState = { running: false, paused: false, mode: null, phase: 'idle' }

/** Lo de los ajustes que obliga a reiniciar una sesión en marcha. La fuente de audio solo cuenta si hay audio. */
const sessionKey = (mode: Mode, fallbackSeconds: number, source: AudioSourceChoice, from: string, targets: readonly string[]): string =>
  `${mode}|${fallbackSeconds}|${mode === 'text' ? '' : source.kind === 'app' ? `app:${source.program}` : 'system'}|${from}>${targets.join('+')}`

/** Resultado de buscar la aplicación elegida entre las que suenan. */
type Resolved = { ok: true; source: AudioSourceRequest } | { ok: false; waiting: true } | { ok: false; waiting: false; notice: Notice }

/** Fallo al resolver la fuente que ya trae su propio aviso. */
class SourceError extends Error {
  readonly notice: Notice
  constructor(notice: Notice) {
    super(notice.message)
    this.notice = notice
  }
}

export class AppController extends EventEmitter<ControllerEvents> {
  private readonly deps: ControllerDeps
  private readonly timers: ControllerTimers
  private readonly waitRetryMs: number
  private current: AppState = { ...IDLE }
  /** Región de la sesión en marcha (`null` en audio), para retomarla si el motor se reinicia tras una caída. */
  private session: { region: SavedRegion | null } | null = null
  /** Modo con el que se arrancó la sesión: los eventos de modo del motor solo valen en automático. */
  private sessionMode: Mode | null = null
  private appliedKey = ''
  private starting = false
  private crashedWhileRunning = false

  /** Cola de órdenes: cada una empieza cuando termina la anterior. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Reinicio encolado que aún no ha empezado (los siguientes se unen a él) y reinicio en ejecución. */
  private restartQueued: Promise<void> | null = null
  private restartRunning: Promise<void> | null = null
  /** Reintento pendiente mientras se espera a la aplicación elegida. */
  private waitTimer: unknown = null

  constructor(deps: ControllerDeps) {
    super()
    this.deps = deps
    this.timers = deps.timers ?? realTimers
    this.waitRetryMs = deps.waitRetryMs ?? WAIT_RETRY_MS
    deps.host.on('event', (event) => this.onEngineEvent(event))
    deps.host.on('crashed', ({ restartInMs }) => {
      this.crashedWhileRunning = this.current.running
      this.cancelWait()
      this.setState({ ...IDLE })
      this.emit('notice', noticeForCrash(restartInMs))
    })
    deps.host.on('ready', () => {
      if (!this.crashedWhileRunning || !this.session) return
      this.crashedWhileRunning = false
      void this.start(this.session.region)
    })
    // Cambiar el modo, la espera del fallback o la fuente con una sesión en marcha la reinicia con lo nuevo.
    deps.settings.onChange((s) => {
      if (this.current.running && sessionKey(s.mode, s.fallbackSeconds, s.audioSource, s.from, s.targets) !== this.appliedKey) void this.queueRestart()
    })
  }

  get state(): AppState {
    return { ...this.current }
  }

  /** Abre el selector de región y, si el usuario elige una, abre el selector de overlay para elegir dónde mostrar la traducción. */
  async chooseRegion(): Promise<boolean> {
    const region = await this.deps.picker.pick()
    if (!region) return false
    const saved = this.deps.settings.update({ lastRegion: region })
    if (!saved.ok) {
      this.emit('notice', { level: 'error', message: 'No se pudo guardar la región elegida' })
      return false
    }

    // Abrir selector de overlay para elegir dónde mostrar la traducción
    const overlayPicker = new OverlayPicker(this.deps.windows, this.deps.displays, region)
    const position = await overlayPicker.pick()
    if (position) {
      const overlaySettings = this.deps.settings.get().overlay
      const positionSaved = this.deps.settings.update({
        overlay: { ...overlaySettings, placement: 'manual', x: position.x, y: position.y },
      })
      if (!positionSaved.ok) {
        this.emit('notice', { level: 'error', message: 'No se pudo guardar la posición del overlay' })
      }
    }

    return this.start(region)
  }

  /** Abre solo el selector de región (sin pasar a overlay); se guarda y comienza si se elige. */
  async pickRegion(): Promise<boolean> {
    const region = await this.deps.picker.pick()
    if (!region) return false
    const saved = this.deps.settings.update({ lastRegion: region })
    if (!saved.ok) {
      this.emit('notice', { level: 'error', message: 'No se pudo guardar la región elegida' })
      return false
    }
    return this.start(region)
  }

  /** Abre solo el selector de posición del overlay (sin cambiar la región). */
  async pickOverlayPosition(): Promise<boolean> {
    const { lastRegion } = this.deps.settings.get()
    if (!lastRegion) {
      this.emit('notice', { level: 'error', message: 'Primero elige una región a traducir' })
      return false
    }
    const overlayPicker = new OverlayPicker(this.deps.windows, this.deps.displays, lastRegion)
    const position = await overlayPicker.pick()
    if (!position) return false
    const overlaySettings = this.deps.settings.get().overlay
    const saved = this.deps.settings.update({
      overlay: { ...overlaySettings, placement: 'manual', x: position.x, y: position.y },
    })
    if (!saved.ok) {
      this.emit('notice', { level: 'error', message: 'No se pudo guardar la posición del overlay' })
      return false
    }
    return true
  }

  /** Marca unos segundos la región guardada sobre la pantalla; `false` si no hay ninguna o hay un selector abierto. */
  async showRegion(): Promise<boolean> {
    const { lastRegion } = this.deps.settings.get()
    return lastRegion ? this.deps.picker.preview(lastRegion) : false
  }

  /** Traduce la última región usada; si no hay ninguna, pide elegirla (salvo en modo audio, que no la necesita). */
  async startSaved(): Promise<boolean> {
    const { mode, lastRegion } = this.deps.settings.get()
    if (!needsRegion(mode)) return this.start(null)
    return lastRegion ? this.start(lastRegion) : this.chooseRegion()
  }

  /**
   * Botón Iniciar: solo hace algo en reposo (repetirlo con una sesión en marcha o arrancando no duplica nada).
   * Si el modo pide región y no hay ninguna guardada, abre el selector (fuera de la cola, para no bloquearla).
   */
  async startSession(): Promise<void> {
    const outcome = await this.enqueue(async () => {
      if (this.current.running) return 'skip' as const
      const { mode, lastRegion } = this.deps.settings.get()
      if (needsRegion(mode) && !lastRegion) return 'pick' as const
      await this.doStart(needsRegion(mode) ? lastRegion : null)
      return 'done' as const
    })
    if (outcome === 'pick') await this.chooseRegion()
  }

  /** Configura el motor con los ajustes actuales y empieza según el modo. `region` se ignora en modo audio. */
  start(region: SavedRegion | null): Promise<boolean> {
    return this.enqueue(() => this.doStart(region))
  }

  stop(): Promise<void> {
    // Cancelar la espera no aguarda el turno: así Detener responde aunque haya una orden lenta delante.
    this.cancelWait()
    return this.enqueue(() => this.doStop())
  }

  /**
   * Pausa. El motor pausa las sesiones de región (también las de fallback); la de solo audio no
   * tiene pausa propia, así que se detiene la captura y `resume` la arranca de nuevo.
   */
  pause(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.current.running || this.current.paused || this.current.phase !== 'running') return
      this.setState({ ...this.current, paused: true, phase: 'paused' })
      await this.deps.host.send({ type: this.sessionMode === 'audio' ? 'stop' : 'pause' }).catch(() => undefined)
    })
  }

  resume(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.current.running || !this.current.paused) return
      if (this.sessionMode === 'audio') {
        const resolved = await this.resolveSource().catch(
          (): Resolved => ({ ok: false, waiting: false, notice: { level: 'error', message: 'No se pudo consultar las aplicaciones con audio' } }),
        )
        if (!resolved.ok) {
          if (resolved.waiting) this.enterWaiting()
          else this.emit('notice', resolved.notice)
          return
        }
        const { from, targets } = this.deps.settings.get()
        await this.deps.host.send({ type: 'startAudio', from, to: targets, source: resolved.source }).catch(() => undefined)
      } else {
        await this.deps.host.send({ type: 'resume' }).catch(() => undefined)
      }
      this.setState({ ...this.current, paused: false, phase: 'running' })
    })
  }

  async togglePause(): Promise<void> {
    if (this.current.paused) await this.resume()
    else await this.pause()
  }

  /**
   * Detiene y vuelve a empezar con los ajustes de ahora. Pulsarlo varias veces seguidas se une a un único
   * reinicio (el que espera turno o el que ya está en marcha). Sin sesión no hace nada.
   */
  restart(): Promise<void> {
    return this.restartQueued ?? this.restartRunning ?? this.queueRestart()
  }

  /** Cambia el modo (se guarda en los ajustes). Con una sesión en marcha, ésta continúa en el modo nuevo. */
  setMode(mode: Mode): void {
    if (this.deps.settings.get().mode === mode) return
    const saved = this.deps.settings.update({ mode })
    if (!saved.ok) this.emit('notice', { level: 'error', message: 'No se pudo guardar el modo elegido' })
    // El reinicio de una sesión en marcha lo dispara el cambio de ajustes.
  }

  /** Atajo de modo: auto -> texto -> audio -> auto. */
  cycleMode(): void {
    this.setMode(nextMode(this.deps.settings.get().mode))
  }

  // ------------------------------------------------------------------------------------- cola

  /** Ejecuta `task` cuando terminen las anteriores; un fallo de una orden no detiene la cola. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run
  }

  /**
   * Encola un reinicio. Si ya hay uno esperando turno se une a él; si hay uno en marcha se encola otro
   * (lo usan los cambios de ajustes, que no deben perderse).
   */
  private queueRestart(): Promise<void> {
    if (this.restartQueued) return this.restartQueued
    const queued: Promise<void> = this.enqueue(async () => {
      this.restartQueued = null
      this.restartRunning = queued
      try {
        await this.doRestart()
      } finally {
        this.restartRunning = null
      }
    })
    this.restartQueued = queued
    return queued
  }

  // --------------------------------------------------------------------------- operaciones

  private async doStart(region: SavedRegion | null): Promise<boolean> {
    const { host, settings } = this.deps
    const current = settings.get()
    const mode = current.mode
    if (needsRegion(mode) && !region) {
      this.emit('notice', { level: 'warning', message: 'Elige una región de la pantalla para este modo' })
      return false
    }
    this.cancelWait()
    this.starting = true
    this.appliedKey = sessionKey(mode, current.fallbackSeconds, current.audioSource, current.from, current.targets)
    this.setState({ running: true, paused: false, mode: initialActive(mode), phase: 'starting' })
    let resolved: Resolved | null = null
    try {
      await host.whenReady()
      await this.deps.configure()
      if (mode === 'audio') {
        resolved = await this.resolveSource()
        if (resolved.ok) await host.send({ type: 'startAudio', from: current.from, to: current.targets, source: resolved.source })
        else if (!resolved.waiting) throw new SourceError(resolved.notice)
      } else {
        await host.send({ type: 'startRegion', rect: region as SavedRegion, from: current.from, to: current.targets })
      }
    } catch (error) {
      this.starting = false
      this.session = null
      this.sessionMode = null
      this.setState({ ...IDLE, phase: 'error' })
      this.emit('notice', error instanceof SourceError ? error.notice : noticeForStartFailure(error instanceof Error ? error.message : String(error)))
      return false
    }
    this.starting = false
    this.session = { region: needsRegion(mode) ? region : null }
    this.sessionMode = mode
    if (resolved && !resolved.ok) this.enterWaiting()
    else this.setState({ running: true, paused: false, mode: initialActive(mode), phase: 'running' })
    return true
  }

  private async doStop(): Promise<void> {
    this.cancelWait()
    this.session = null
    this.sessionMode = null
    this.crashedWhileRunning = false
    this.setState({ ...IDLE })
    if (this.deps.host.isReady) await this.deps.host.send({ type: 'stop' }).catch(() => undefined)
    this.deps.windows.get('overlay')?.webContents.send(Channel.overlayClear)
  }

  /** Detener + iniciar con los ajustes actuales (la región de la sesión, o la guardada si el modo nuevo la pide). */
  private async doRestart(): Promise<void> {
    if (!this.current.running) return
    const { mode, lastRegion } = this.deps.settings.get()
    const region = this.session?.region ?? lastRegion
    if (needsRegion(mode) && !region) {
      // Sin región no se puede seguir: se detiene y se pide elegirla (el selector va fuera de la cola).
      await this.doStop()
      void this.chooseRegion()
      return
    }
    this.cancelWait()
    if (this.deps.host.isReady) await this.deps.host.send({ type: 'stop' }).catch(() => undefined)
    await this.doStart(needsRegion(mode) ? region : null)
  }

  // ------------------------------------------------------------------- fuente y espera

  /** Busca entre las aplicaciones que suenan la que eligió el usuario (por nombre de programa). */
  private async resolveSource(): Promise<Resolved> {
    const choice = this.deps.settings.get().audioSource
    if (choice.kind === 'system') return { ok: true, source: { kind: 'system' } }
    const info = await this.deps.host.send({ type: 'listAudioSources' })
    if (!info.supported) {
      return {
        ok: false,
        waiting: false,
        notice: { level: 'error', message: `Esta plataforma no permite capturar el audio de una aplicación (${info.reason}); elige «Todo el sistema»` },
      }
    }
    const wanted = choice.program.toLowerCase()
    const app = info.apps.find((a) => a.name.toLowerCase() === wanted)
    return app ? { ok: true, source: { kind: 'app', id: app.id, name: app.name } } : { ok: false, waiting: true }
  }

  /** La aplicación elegida no suena: la sesión queda en espera y se reintenta cada pocos segundos. */
  private enterWaiting(): void {
    const source = this.deps.settings.get().audioSource
    const program = source.kind === 'app' ? source.program : ''
    this.setState({ running: true, paused: false, mode: 'audio', phase: 'waiting', waitingFor: program })
    this.emit('notice', { level: 'info', message: `Esperando a que suene ${program}; la traducción empezará sola` })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.waitTimer !== null) this.timers.clearTimer(this.waitTimer)
    this.waitTimer = this.timers.setTimer(() => {
      this.waitTimer = null
      void this.enqueue(() => this.retryWaiting())
    }, this.waitRetryMs)
  }

  private cancelWait(): void {
    if (this.waitTimer !== null) this.timers.clearTimer(this.waitTimer)
    this.waitTimer = null
  }

  private async retryWaiting(): Promise<void> {
    if (this.current.phase !== 'waiting') return
    let resolved: Resolved
    try {
      resolved = await this.resolveSource()
    } catch {
      this.scheduleRetry() // el motor no contestó: se vuelve a intentar
      return
    }
    if (this.current.phase !== 'waiting') return // detenida mientras se consultaba
    if (!resolved.ok) {
      if (resolved.waiting) this.scheduleRetry()
      else {
        this.emit('notice', resolved.notice)
        await this.doStop()
      }
      return
    }
    const { from, targets } = this.deps.settings.get()
    try {
      await this.deps.host.send({ type: 'startAudio', from, to: targets, source: resolved.source })
    } catch {
      this.scheduleRetry()
      return
    }
    if (this.current.phase !== 'waiting') return
    this.setState({ running: true, paused: false, mode: 'audio', phase: 'running' })
  }

  /** Un error de captura con una aplicación como fuente puede significar que se cerró: se comprueba. */
  private checkSourceLost(): void {
    const { audioSource } = this.deps.settings.get()
    if (this.sessionMode !== 'audio' || audioSource.kind !== 'app' || this.current.phase !== 'running') return
    void this.enqueue(async () => {
      if (this.current.phase !== 'running') return
      const resolved = await this.resolveSource().catch((): Resolved => ({ ok: true, source: { kind: 'system' } }))
      if (resolved.ok || !resolved.waiting) return
      await this.deps.host.send({ type: 'stop' }).catch(() => undefined)
      this.enterWaiting()
    })
  }

  // ----------------------------------------------------------------------------- estado

  private setState(next: AppState): void {
    const c = this.current
    const same =
      next.running === c.running && next.paused === c.paused && next.mode === c.mode && next.phase === c.phase && next.waitingFor === c.waitingFor
    if (same) return
    this.current = next
    this.emit('state', this.state)
  }

  private onEngineEvent(event: EngineEvent): void {
    switch (event.name) {
      case 'translation': {
        const text: OverlayText = { original: event.payload.original, lang: this.deps.settings.get().from, translations: event.payload.translations, final: true }
        this.emit('text', text)
        return
      }
      case 'subtitle': {
        const { original, translations, isFinal } = event.payload
        this.emit('text', { original, lang: this.deps.settings.get().from, translations, final: isFinal })
        return
      }
      case 'textCleared':
        this.emit('clearText')
        return
      case 'error':
        this.emit('notice', noticeForEngineError(event.payload.category, event.payload.message))
        if (event.payload.category === 'capture') this.checkSourceLost()
        return
      case 'mode': {
        // Solo el fallback emite modos; los de una sesión anterior o de otro modo se ignoran.
        if (this.sessionMode !== 'auto' || (!this.current.running && !this.starting)) return
        const { mode } = event.payload
        const phase = (paused: boolean): SessionPhase => (paused ? 'paused' : 'running')
        if (mode === 'paused') this.setState({ ...this.current, running: true, paused: true, phase: phase(true) })
        else if (mode === 'text' || mode === 'audio') this.setState({ running: true, paused: false, mode, phase: phase(false) })
        return
      }
      case 'modelProgress':
      case 'audioLevel':
        return
    }
  }
}
