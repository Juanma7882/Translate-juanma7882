// Canales IPC de la ventana de Ajustes. Solo se atienden mensajes que vienen de esa ventana.

import { readFileSync, statSync, writeFileSync } from 'node:fs'

import { ipcMain } from 'electron'
import type { ModelScope } from 'tr-bindings'

import { Channel } from '../shared/ipc.ts'
import type { AppState, ModelProgress, Notice, TransferResult } from '../shared/ipc.ts'
import type { EngineEvent } from '../shared/protocol.ts'
import type { Settings } from '../shared/settings.ts'
import { exportSettings, importSettings, MAX_IMPORT_BYTES } from '../shared/settings-transfer.ts'
import type { AppController } from './app-controller.ts'
import { AudioMonitor, MONITOR_CHANNELS, registerMonitorIpc } from './audio-monitor.ts'
import type { EngineHost } from './engine-host.ts'
import type { ModelsService } from './models-service.ts'
import { guardedHandle, registerSessionIpc, SESSION_CHANNELS } from './session-ipc.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** El ámbito llega del renderer: solo se aceptan los valores conocidos (por defecto, texto). */
function parseScope(value: unknown): ModelScope | undefined {
  return value === 'audio' || value === 'all' || value === 'text' ? value : undefined
}

/** Los destinos llegan del renderer: solo se aceptan listas cortas de textos. */
function parseTargets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2 || !value.every((code) => typeof code === 'string')) throw new Error('invalid targets')
  return value as string[]
}

/** Diálogos del sistema para elegir carpetas y archivos; las pruebas los sustituyen por rutas fijas. */
export interface FilePrompts {
  pickFolder(): Promise<string | null>
  chooseExportPath(): Promise<string | null>
  chooseImportPath(): Promise<string | null>
}

const isDict = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface SettingsIpcDeps {
  files: FilePrompts
  windows: WindowManager
  settings: SettingsStore
  models: ModelsService
  host: EngineHost
  controller: AppController
}

/** Registra los canales y devuelve una función que los retira. */
export function registerSettingsIpc({ windows, settings, models, host, controller, files }: SettingsIpcDeps): () => void {
  const toWindow = (channel: string, payload: unknown): void => {
    windows.get('settings')?.webContents.send(channel, payload)
  }
  // Rechaza cualquier invocación que no venga de la ventana de Ajustes.
  const handle = guardedHandle(ipcMain as never, () => windows.get('settings')?.webContents ?? null)

  handle(Channel.settingsGet, () => settings.get())
  handle(Channel.settingsUpdate, async (patch: unknown) => {
    // La carpeta de modelos se valida con el motor antes de guardarla y no cambia durante una sesión.
    if (isDict(patch) && 'modelsDir' in patch) {
      if (controller.state.running) return { ok: false as const, errors: ['invalid modelsDir: running'] }
      if (typeof patch['modelsDir'] === 'string') {
        const check = await models.validateDir(patch['modelsDir'])
        if (!check.ok) return { ok: false as const, errors: [`invalid modelsDir: ${check.reason}`] }
      }
    }
    return settings.update(patch)
  })
  handle(Channel.settingsReset, () => settings.reset())
  handle(Channel.settingsExport, async (): Promise<TransferResult> => {
    const path = await files.chooseExportPath()
    if (!path) return { ok: false, canceled: true }
    try {
      writeFileSync(path, `${JSON.stringify(exportSettings(settings.get()), null, 2)}
`, 'utf8')
      return { ok: true }
    } catch {
      return { ok: false, errors: ['export failed'] }
    }
  })
  handle(Channel.settingsImport, async (): Promise<TransferResult> => {
    const path = await files.chooseImportPath()
    if (!path) return { ok: false, canceled: true }
    let text: string
    try {
      if (statSync(path).size > MAX_IMPORT_BYTES) return { ok: false, errors: ['import too large'] }
      text = readFileSync(path, 'utf8')
    } catch {
      return { ok: false, errors: ['import could not be read'] }
    }
    const parsed = importSettings(text, settings.get())
    if (!parsed.ok) return parsed
    const saved = settings.replace(parsed.settings)
    return saved.ok ? { ok: true, settings: saved.settings } : { ok: false, errors: saved.errors }
  })
  handle(Channel.modelsInventory, () => models.inventory())
  handle(Channel.modelsDelete, (id: unknown) => models.deleteModel(String(id)))
  handle(Channel.modelsCancel, () => models.cancelDownload())
  handle(Channel.modelsValidateDir, (path: unknown) => models.validateDir(String(path)))
  handle(Channel.modelsPickDir, () => files.pickFolder())
  handle(Channel.modelsCatalog, () => models.catalog())
  handle(Channel.modelsStatus, (from: string, to: unknown, scope?: unknown) => models.status(String(from), parseTargets(to), parseScope(scope)))
  handle(Channel.modelsDownload, (from: string, to: unknown, scope?: unknown) => models.download(String(from), parseTargets(to), parseScope(scope)))

  const disposeSession = registerSessionIpc({ handle, controller, host, toWindow })

  // Escucha previa del nivel: la ventana solo dice si Inicio está a la vista; aquí se decide si toca escuchar.
  const monitor = new AudioMonitor({ host, controller, settings, prepare: () => models.ensureConfigured() })
  const watchedWindows = new WeakSet<object>()
  const disposeMonitorIpc = registerMonitorIpc({
    handle,
    monitor,
    toWindow,
    onWindowGone: (callback) => {
      const window = windows.get('settings')
      if (!window || watchedWindows.has(window)) return
      watchedWindows.add(window)
      window.once('closed', callback)
    },
  })

  const onSettings = settings.onChange((s: Settings) => toWindow(Channel.settingsChanged, s))
  const onEvent = (event: EngineEvent): void => {
    if (event.name === 'modelProgress') {
      const { model, downloaded, total } = event.payload
      const progress: ModelProgress = { model, downloaded, total: total ?? null }
      toWindow(Channel.modelsProgress, progress)
    }
  }
  const onState = (state: AppState): void => toWindow(Channel.appState, state)
  const onNotice = (notice: Notice): void => toWindow(Channel.appNotice, notice)
  host.on('event', onEvent)
  controller.on('state', onState)
  controller.on('notice', onNotice)

  return () => {
    for (const channel of [
      Channel.settingsGet,
      Channel.settingsUpdate,
      Channel.settingsReset,
      Channel.settingsExport,
      Channel.settingsImport,
      Channel.modelsCatalog,
      Channel.modelsStatus,
      Channel.modelsDownload,
      Channel.modelsInventory,
      Channel.modelsDelete,
      Channel.modelsCancel,
      Channel.modelsValidateDir,
      Channel.modelsPickDir,
      ...SESSION_CHANNELS,
      ...MONITOR_CHANNELS,
    ]) {
      ipcMain.removeHandler(channel)
    }
    onSettings()
    disposeSession()
    disposeMonitorIpc()
    monitor.dispose()
    host.off('event', onEvent)
    controller.off('state', onState)
    controller.off('notice', onNotice)
  }
}

/** Diálogos guionizados para las pruebas de humo: devuelven lo que se les haya puesto. */
export function scriptedFiles(): FilePrompts & { folder: string | null; exportTo: string | null; importFrom: string | null } {
  const files = {
    folder: null as string | null,
    exportTo: null as string | null,
    importFrom: null as string | null,
    pickFolder: () => Promise.resolve(files.folder),
    chooseExportPath: () => Promise.resolve(files.exportTo),
    chooseImportPath: () => Promise.resolve(files.importFrom),
  }
  return files
}
