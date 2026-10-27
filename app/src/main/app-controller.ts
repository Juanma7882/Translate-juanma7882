// Controlador de la aplicación: une selector de región, ajustes, motor y overlay.

import { EventEmitter } from 'node:events'

import { Channel } from '../shared/ipc.ts'
import type { AppState, Notice, OverlayText } from '../shared/ipc.ts'
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

export class AppController extends EventEmitter<ControllerEvents> {
  private readonly deps: ControllerDeps
  private current: AppState = { running: false, paused: false }
  /** Región de la sesión en marcha, para retomarla si el motor se reinicia tras una caída. */
  private session: SavedRegion | null = null
  private crashedWhileRunning = false

  constructor(deps: ControllerDeps) {
    super()
    this.deps = deps
    deps.host.on('event', (event) => this.onEngineEvent(event))
    deps.host.on('crashed', ({ restartInMs }) => {
      this.crashedWhileRunning = this.current.running
      this.setState({ running: false, paused: false })
      this.emit('notice', noticeForCrash(restartInMs))
    })
    deps.host.on('ready', () => {
      if (!this.crashedWhileRunning || !this.session) return
      this.crashedWhileRunning = false
      void this.start(this.session)
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

  /** Traduce la última región usada; si no hay ninguna, pide elegirla. */
  async startSaved(): Promise<boolean> {
    const region = this.deps.settings.get().lastRegion
    return region ? this.start(region) : this.chooseRegion()
  }

  /** Configura el motor con los ajustes actuales y empieza a traducir `region`. */
  async start(region: SavedRegion): Promise<boolean> {
    const { host, settings } = this.deps
    const current = settings.get()
    try {
      await host.whenReady()
      await this.deps.configure()
      await host.send({ type: 'startRegion', rect: region, from: current.from, to: current.to })
    } catch (error) {
      this.setState({ running: false, paused: false })
      this.emit('notice', noticeForStartFailure(error instanceof Error ? error.message : String(error)))
      return false
    }
    this.session = region
    this.setState({ running: true, paused: false })
    return true
  }

  async stop(): Promise<void> {
    this.session = null
    this.crashedWhileRunning = false
    this.setState({ running: false, paused: false })
    if (this.deps.host.isReady) await this.deps.host.send({ type: 'stop' }).catch(() => undefined)
    this.deps.windows.get('overlay')?.webContents.send(Channel.overlayClear)
  }

  async pause(): Promise<void> {
    if (!this.current.running || this.current.paused) return
    this.setState({ running: true, paused: true })
    await this.deps.host.send({ type: 'pause' }).catch(() => undefined)
  }

  async resume(): Promise<void> {
    if (!this.current.running || !this.current.paused) return
    await this.deps.host.send({ type: 'resume' }).catch(() => undefined)
    this.setState({ running: true, paused: false })
  }

  async togglePause(): Promise<void> {
    if (this.current.paused) await this.resume()
    else await this.pause()
  }

  private setState(next: AppState): void {
    if (next.running === this.current.running && next.paused === this.current.paused) return
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
      case 'mode':
        if (event.payload.mode === 'paused') this.setState({ running: true, paused: true })
        else if (event.payload.mode === 'text' || event.payload.mode === 'audio') this.setState({ running: true, paused: false })
        return
      case 'modelProgress':
        return
    }
  }
}
