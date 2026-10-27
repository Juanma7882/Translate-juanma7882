// Preload de Ajustes: leer y cambiar ajustes, consultar y descargar modelos, y escuchar el estado.
// Importa de `shared/` únicamente tipos (ver `selector.ts`).

import { contextBridge, ipcRenderer } from 'electron'

import type { AppState, Channel, ModelProgress, Notice, SettingsApi } from '../shared/ipc.ts'
import type { Settings } from '../shared/settings.ts'

const GET = 'settings:get' satisfies typeof Channel.settingsGet
const UPDATE = 'settings:update' satisfies typeof Channel.settingsUpdate
const CHANGED = 'settings:changed' satisfies typeof Channel.settingsChanged
const MODELS_CATALOG = 'models:catalog' satisfies typeof Channel.modelsCatalog
const MODELS_STATUS = 'models:status' satisfies typeof Channel.modelsStatus
const MODELS_DOWNLOAD = 'models:download' satisfies typeof Channel.modelsDownload
const MODELS_PROGRESS = 'models:progress' satisfies typeof Channel.modelsProgress
const APP_STATE = 'app:state' satisfies typeof Channel.appState
const NOTICE = 'app:notice' satisfies typeof Channel.appNotice

const api: SettingsApi = {
  getSettings: () => ipcRenderer.invoke(GET),
  updateSettings: (patch) => ipcRenderer.invoke(UPDATE, patch),
  modelCatalog: () => ipcRenderer.invoke(MODELS_CATALOG),
  modelStatus: (from, to, scope) => ipcRenderer.invoke(MODELS_STATUS, from, to, scope),
  downloadModels: (from, to, scope) => ipcRenderer.invoke(MODELS_DOWNLOAD, from, to, scope),
  onSettingsChanged(listener) {
    ipcRenderer.on(CHANGED, (_event, settings: Settings) => listener(settings))
  },
  onModelProgress(listener) {
    ipcRenderer.on(MODELS_PROGRESS, (_event, progress: ModelProgress) => listener(progress))
  },
  onAppState(listener) {
    ipcRenderer.on(APP_STATE, (_event, state: AppState) => listener(state))
  },
  onNotice(listener) {
    ipcRenderer.on(NOTICE, (_event, notice: Notice) => listener(notice))
  },
}

contextBridge.exposeInMainWorld('trSettings', api)
