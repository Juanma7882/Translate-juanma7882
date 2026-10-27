// Controlador de la aplicación: une selector de región, ajustes, motor y overlay.
//
// El modo (`auto`, `text`, `audio`) sale de los ajustes y decide la orden al motor: automático y
// solo texto usan `startRegion` (con o sin fallback, según las opciones del motor); solo audio usa
// `startAudio` y no necesita región. Cambiar el modo con una sesión en marcha la reinicia.

import { EventEmitter } from 'node:events'

import { Channel } from '../shared/ipc.ts'
import type { AppState, Notice, OverlayText } from '../shared/ipc.ts'
import { initialActive, needsRegion, nextMode } from '../shared/mode.ts'
import type { Mode } from '../shared/mode.ts'
import type { EngineEvent } from '../shared/protocol.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { EngineHost } from './engine-host.ts'
import { noticeForCrash, noticeForEngineError, noticeForStartFailure } from './notices.ts'
import type { RegionPicker } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

export interface ControllerDeps {
  host: EngineHost
  windows: WindowManager
  settings: SettingsStore
  picker: RegionPicker
  /** Configura el motor con los ajustes actuales (lo hace al arrancar una traducción). */
  configure: () => Promise<void>
}

interface ControllerEvents {
  state: [AppState]
  notice: [Notice]
  /** Texto de una traducción o subtítulo ya preparado para mostrar. */
  text: [OverlayText]
}

const IDLE: AppState = { running: false, paused: false, mode: null }

/** Lo de los ajustes que obliga a reiniciar una sesión en marcha. */
const sessionKey = (mode: Mode, fallbackSeconds: number): string => `${mode}|${fallbackSeconds}`

export class AppController extends EventEmitter<ControllerEvents> {
  private readonly deps: ControllerDeps
  private current: AppState = { ...IDLE }
  /** Región de la sesión en marcha (`null` en audio), para retomarla si el motor se reinicia tras una caída. */
  private session: { region: SavedRegion | null } | null = null
  /** Modo con el que se arrancó la sesión: los eventos de modo del motor solo valen en automático. */
  private sessionMode: Mode | null = null
  private appliedKey = ''
  private starting = false
  private crashedWhileRunning = false

  constructor(deps: ControllerDeps) {
    super()
    this.deps = deps
    deps.host.on('event', (event) => this.onEngineEvent(event))
    deps.host.on('crashed', ({ restartInMs }) => {
      this.crashedWhileRunning = this.current.running
      this.setState({ ...IDLE })
      this.emit('notice', noticeForCrash(restartInMs))
    })
    deps.host.on('ready', () => {
      if (!this.crashedWhileRunning || !this.session) return
      this.crashedWhileRunning = false
      void this.start(this.session.region)
    })
    // Cambiar el modo o la espera del fallback con una sesión en marcha la reinicia con lo nuevo.
    deps.settings.onChange((s) => {
      if (this.current.running && sessionKey(s.mode, s.fallbackSeconds) !== this.appliedKey) void this.restart()
    })
  }

  get state(): AppState {
    return { ...this.current }
  }

  /** Abre el selector y, si el usuario elige una región, la guarda y empieza a traducirla. */
  async chooseRegion(): Promise<boolean> {
    const region = await this.deps.picker.pick()
    if (!region) return false
    const saved = this.deps.settings.update({ lastRegion: region })
    if (!saved.ok) {
      this.emit('notice', { level: 'error', message: 'No se pudo guardar la región elegida' })
      return false
    }
    return this.start(region)
  }

  /** Traduce la última región usada; si no hay ninguna, pide elegirla (salvo en modo audio, que no la necesita). */
  async startSaved(): Promise<boolean> {
    const { mode, lastRegion } = this.deps.settings.get()
    if (!needsRegion(mode)) return this.start(null)
    return lastRegion ? this.start(lastRegion) : this.chooseRegion()
  }

  /** Configura el motor con los ajustes actuales y empieza según el modo. `region` se ignora en modo audio. */
  async start(region: SavedRegion | null): Promise<boolean> {
    const { host, settings } = this.deps
    const current = settings.get()
    const mode = current.mode
    if (needsRegion(mode) && !region) {
      this.emit('notice', { level: 'warning', message: 'Elige una región de la pantalla para este modo' })
      return false
    }
    this.starting = true
    try {
      await host.whenReady()
      await this.deps.configure()
      if (mode === 'audio') await host.send({ type: 'startAudio', from: current.from, to: current.to })
      else await host.send({ type: 'startRegion', rect: region as SavedRegion, from: current.from, to: current.to })
    } catch (error) {
      this.starting = false
      this.session = null
      this.sessionMode = null
      this.setState({ ...IDLE })
      this.emit('notice', noticeForStartFailure(error instanceof Error ? error.message : String(error)))
      return false
    }
    this.starting = false
    this.session = { region: needsRegion(mode) ? region : null }
    this.sessionMode = mode
    this.appliedKey = sessionKey(mode, current.fallbackSeconds)
    this.setState({ running: true, paused: false, mode: initialActive(mode) })
    return true
  }

  async stop(): Promise<void> {
    this.session = null
    this.sessionMode = null
    this.crashedWhileRunning = false
    this.setState({ ...IDLE })
    if (this.deps.host.isReady) await this.deps.host.send({ type: 'stop' }).catch(() => undefined)
    this.deps.windows.get('overlay')?.webContents.send(Channel.overlayClear)
  }

  /**
   * Pausa. El motor pausa las sesiones de región (también las de fallback); la de solo audio no
   * tiene pausa propia, así que se detiene la captura y `resume` la arranca de nuevo.
   */
  async pause(): Promise<void> {
    if (!this.current.running || this.current.paused) return
    this.setState({ ...this.current, paused: true })
    await this.deps.host.send({ type: this.sessionMode === 'audio' ? 'stop' : 'pause' }).catch(() => undefined)
  }

  async resume(): Promise<void> {
    if (!this.current.running || !this.current.paused) return
    if (this.sessionMode === 'audio') {
      const { from, to } = this.deps.settings.get()
      await this.deps.host.send({ type: 'startAudio', from, to }).catch(() => undefined)
    } else {
      await this.deps.host.send({ type: 'resume' }).catch(() => undefined)
    }
    this.setState({ ...this.current, paused: false })
  }

  async togglePause(): Promise<void> {
    if (this.current.paused) await this.resume()
    else await this.pause()
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

  /** Vuelve a arrancar la sesión actual con los ajustes de ahora (otro modo, otra espera). */
  private async restart(): Promise<void> {
    const mode = this.deps.settings.get().mode
    const region = this.session?.region ?? this.deps.settings.get().lastRegion
    this.appliedKey = sessionKey(mode, this.deps.settings.get().fallbackSeconds)
    if (needsRegion(mode) && !region) {
      await this.chooseRegion()
      return
    }
    await this.start(region)
  }

  private setState(next: AppState): void {
    const same = next.running === this.current.running && next.paused === this.current.paused && next.mode === this.current.mode
    if (same) return
    this.current = next
    this.emit('state', this.state)
  }

  private onEngineEvent(event: EngineEvent): void {
    switch (event.name) {
      case 'translation': {
        const text: OverlayText = { original: event.payload.original, translated: event.payload.translated, final: true }
        this.emit('text', text)
        return
      }
      case 'subtitle': {
        const { original, translated, isFinal } = event.payload
        this.emit('text', { original, translated: translated ?? null, final: isFinal })
        return
      }
      case 'error':
        this.emit('notice', noticeForEngineError(event.payload.category, event.payload.message))
        return
      case 'mode': {
        // Solo el fallback emite modos; los de una sesión anterior o de otro modo se ignoran.
        if (this.sessionMode !== 'auto' || (!this.current.running && !this.starting)) return
        const { mode } = event.payload
        if (mode === 'paused') this.setState({ ...this.current, running: true, paused: true })
        else if (mode === 'text' || mode === 'audio') this.setState({ running: true, paused: false, mode })
        return
      }
      case 'modelProgress':
        return
    }
  }
}
