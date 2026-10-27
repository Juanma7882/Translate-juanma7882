// Modelos de traducción desde el proceso principal: catálogo, estado y descarga, y la configuración
// del motor que los hace posibles.
//
// `configure` detiene lo que el motor tenga en marcha, así que solo se llama cuando no hay una
// traducción en curso (o al arrancar una, que es justo cuando se quiere).

import type { EngineOptions, ModelCatalog, ModelStatusInfo } from 'tr-bindings'

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
  private async ensureConfigured(): Promise<void> {
    await this.host.whenReady()
    if (this.isRunning()) return
    if (JSON.stringify(this.options()) !== this.configuredKey) await this.configure()
  }

  async catalog(): Promise<ModelCatalog> {
    await this.ensureConfigured()
    return this.host.send({ type: 'modelCatalog' })
  }

  async status(from: string, to: string): Promise<ModelStatusInfo[]> {
    await this.ensureConfigured()
    return this.host.send({ type: 'modelStatus', from, to })
  }

  /** Avisa cada vez que una descarga termina bien. */
  onDownloaded(listener: () => void): void {
    this.downloadedListeners.push(listener)
  }

  /** Descarga lo que falte; el avance llega como eventos `modelProgress` del motor. */
  async download(from: string, to: string): Promise<void> {
    await this.ensureConfigured()
    await this.host.send({ type: 'downloadModels', from, to })
    for (const listener of this.downloadedListeners) listener()
  }
}
