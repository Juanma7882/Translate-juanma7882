// Canales IPC de la ventana de Ajustes. Solo se atienden mensajes que vienen de esa ventana.

import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { Channel } from '../shared/ipc.ts'
import type { AppState, ModelProgress, Notice } from '../shared/ipc.ts'
import type { EngineEvent } from '../shared/protocol.ts'
import type { Settings } from '../shared/settings.ts'
import type { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import type { ModelsService } from './models-service.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

export interface SettingsIpcDeps {
  windows: WindowManager
  settings: SettingsStore
  models: ModelsService
  host: EngineHost
  controller: AppController
}

/** Registra los canales y devuelve una función que los retira. */
export function registerSettingsIpc({ windows, settings, models, host, controller }: SettingsIpcDeps): () => void {
  const toWindow = (channel: string, payload: unknown): void => {
    windows.get('settings')?.webContents.send(channel, payload)
  }
  // Rechaza cualquier invocación que no venga de la ventana de Ajustes.
  const guard = (event: IpcMainInvokeEvent): void => {
    const window = windows.get('settings')
    if (!window || event.sender !== window.webContents) throw new Error('unauthorized sender')
  }
  const handle = <A extends unknown[], R>(channel: string, run: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, (event, ...args) => {
      guard(event)
      return run(...(args as A))
    })
  }

  handle(Channel.settingsGet, () => settings.get())
  handle(Channel.settingsUpdate, (patch: unknown) => settings.update(patch))
  handle(Channel.modelsCatalog, () => models.catalog())
  handle(Channel.modelsStatus, (from: string, to: string) => models.status(String(from), String(to)))
  handle(Channel.modelsDownload, (from: string, to: string) => models.download(String(from), String(to)))

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
    for (const channel of [Channel.settingsGet, Channel.settingsUpdate, Channel.modelsCatalog, Channel.modelsStatus, Channel.modelsDownload]) {
      ipcMain.removeHandler(channel)
    }
    onSettings()
    host.off('event', onEvent)
    controller.off('state', onState)
    controller.off('notice', onNotice)
  }
}
