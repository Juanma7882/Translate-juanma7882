// Modelos de traducción desde el proceso principal: catálogo, estado y descarga, y la configuración
// del motor que los hace posibles.
//
// `configure` detiene lo que el motor tenga en marcha, así que solo se llama cuando no hay una
// traducción en curso (o al arrancar una, que es justo cuando se quiere).

import type { EngineOptions, ModelCatalog, ModelInventory, ModelScope, ModelStatusInfo } from 'tr-bindings'

import type { DeleteResult, DirCheck, DirFailure } from '../shared/ipc.ts'

import { engineOptionsFrom } from './engine-options.ts'
import type { EngineHost } from './engine-host.ts'
import type { SettingsStore } from './settings-store.ts'

export class ModelsService {
  private readonly host: EngineHost
  private readonly settings: SettingsStore
  private readonly overrides: () => EngineOptions
  private readonly isRunning: () => boolean
  private configuredKey: string | null = null
  private readonly downloadedListeners: (() => void)[] = []

  /**
   * `overrides` añade opciones al motor (p. ej. un manifiesto alternativo para un espejo propio o
   * para pruebas); `isRunning` dice si hay una traducción en marcha.
   */
  constructor(host: EngineHost, settings: SettingsStore, isRunning: () => boolean, overrides: () => EngineOptions = () => ({})) {
    this.host = host
    this.settings = settings
    this.isRunning = isRunning
    this.overrides = overrides
    // Un motor reiniciado vuelve a su configuración por defecto: hay que reconfigurarlo.
    host.on('crashed', () => {
      this.configuredKey = null
    })
  }

  /** Opciones completas del motor según los ajustes actuales. */
  options(): EngineOptions {
    return { ...engineOptionsFrom(this.settings.get()), ...this.overrides() }
  }

  /** Configura el motor sin condiciones (al arrancar una traducción). */
  async configure(): Promise<void> {
    await this.host.whenReady()
    const options = this.options()
    await this.host.send({ type: 'configure', options })
    this.configuredKey = JSON.stringify(options)
  }

  /** Configura el motor solo si hace falta y no hay una traducción en curso. */
  async ensureConfigured(): Promise<void> {
    await this.host.whenReady()
    if (this.isRunning()) return
    if (JSON.stringify(this.options()) !== this.configuredKey) await this.configure()
  }

  async catalog(): Promise<ModelCatalog> {
    await this.ensureConfigured()
    return this.host.send({ type: 'modelCatalog' })
  }

  /** `scope`: modelos de texto (por defecto), de audio o ambos. */
  async status(from: string, to: string[], scope?: ModelScope): Promise<ModelStatusInfo[]> {
    await this.ensureConfigured()
    return this.host.send({ type: 'modelStatus', from, to, scope })
  }

  /** Avisa cada vez que una descarga termina bien. */
  onDownloaded(listener: () => void): void {
    this.downloadedListeners.push(listener)
  }

  /** Descarga lo que falte; el avance llega como eventos `modelProgress` del motor. */
  async download(from: string, to: string[], scope?: ModelScope): Promise<void> {
    await this.ensureConfigured()
    await this.host.send({ type: 'downloadModels', from, to, scope })
    for (const listener of this.downloadedListeners) listener()
  }

  /** Todos los modelos del manifiesto con su espacio en disco. */
  async inventory(): Promise<ModelInventory> {
    await this.ensureConfigured()
    return this.host.send({ type: 'modelInventory' })
  }

  /** Borra un modelo. Nunca con una traducción en marcha (los modelos están en uso). */
  async deleteModel(id: string): Promise<DeleteResult> {
    if (this.isRunning()) return { ok: false, reason: 'running' }
    await this.ensureConfigured()
    try {
      const freed = await this.host.send({ type: 'deleteModel', modelId: id })
      return { ok: true, freed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('being downloaded')) return { ok: false, reason: 'downloading' }
      if (message.includes('unknown model') || message.includes('not a valid model name')) return { ok: false, reason: 'unknown' }
      if (message.includes('translation is running')) return { ok: false, reason: 'running' }
      return { ok: false, reason: 'failed' }
    }
  }

  /** Cancela la descarga en curso; lo descargado se conserva para reanudar. */
  async cancelDownload(): Promise<void> {
    await this.host.whenReady()
    await this.host.send({ type: 'cancelDownload' })
  }

  /** Comprueba una carpeta de modelos candidata; no se cambia con una traducción en marcha. */
  async validateDir(path: string): Promise<DirCheck> {
    if (this.isRunning()) return { ok: false, reason: 'running' }
    if (path.trim() === '') return { ok: false, reason: 'empty' }
    await this.host.whenReady()
    const check = await this.host.send({ type: 'validateModelsDir', path })
    return check.ok ? { ok: true } : { ok: false, reason: (check.reason ?? 'not-writable') as DirFailure }
  }
}
