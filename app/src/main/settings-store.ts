// Persistencia de los ajustes en un archivo JSON dentro de la carpeta de datos de la aplicación.
//
// Es la única escritura a disco desde JS y solo contiene preferencias (nunca contenido del
// usuario). Se escribe de forma atómica (archivo temporal + rename) para no dejar un JSON a medias.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { applyPatch, defaultSettings, parseSettings } from '../shared/settings.ts'
import type { Settings, UpdateResult } from '../shared/settings.ts'

export interface LoadResult {
  settings: Settings
  /** Avisos sin valores (p. ej. "invalid overlay.opacity"); vacío si todo estaba bien. */
  warnings: string[]
}

type Listener = (settings: Settings) => void

export class SettingsStore {
  private readonly file: string
  private current: Settings = defaultSettings()
  private readonly listeners = new Set<Listener>()

  constructor(file: string) {
    this.file = file
  }

  /** Lee el archivo. Si no existe (primer uso) usa los valores por defecto sin avisos. */
  load(): LoadResult {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      this.current = defaultSettings()
      return { settings: this.current, warnings: missing ? [] : ['settings file could not be read; using defaults'] }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      this.current = defaultSettings()
      return { settings: this.current, warnings: ['settings file is damaged; using defaults'] }
    }
    const { settings, warnings } = parseSettings(raw)
    this.current = settings
    return { settings, warnings }
  }

  get(): Settings {
    return structuredClone(this.current)
  }

  /** Valida y aplica un parche; si es válido lo guarda y avisa a los suscriptores. */
  update(patch: unknown): UpdateResult {
    const result = applyPatch(this.current, patch)
    if (!result.ok) return result
    this.persist(result.settings)
    this.current = result.settings
    for (const listener of this.listeners) listener(this.get())
    return { ok: true, settings: this.get() }
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private persist(settings: Settings): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    renameSync(temporary, this.file)
  }
}
