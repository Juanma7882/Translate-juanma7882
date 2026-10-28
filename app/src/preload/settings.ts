// Preload de Ajustes: leer y cambiar ajustes, gestionar modelos y escuchar el estado.
// Importa de `shared/` únicamente tipos (ver `selector.ts`).

import { contextBridge, ipcRenderer } from 'electron'

import type { AppState, Channel, ModelProgress, Notice, SettingsApi } from '../shared/ipc.ts'
import type { Settings } from '../shared/settings.ts'

const GET = 'settings:get' satisfies typeof Channel.settingsGet
const UPDATE = 'settings:update' satisfies typeof Channel.settingsUpdate
const RESET = 'settings:reset' satisfies typeof Channel.settingsReset
const EXPORT = 'settings:export' satisfies typeof Channel.settingsExport
const IMPORT = 'settings:import' satisfies typeof Channel.settingsImport
const CHANGED = 'settings:changed' satisfies typeof Channel.settingsChanged
const MODELS_CATALOG = 'models:catalog' satisfies typeof Channel.modelsCatalog
const MODELS_STATUS = 'models:status' satisfies typeof Channel.modelsStatus
const MODELS_DOWNLOAD = 'models:download' satisfies typeof Channel.modelsDownload
const MODELS_PROGRESS = 'models:progress' satisfies typeof Channel.modelsProgress
const MODELS_INVENTORY = 'models:inventory' satisfies typeof Channel.modelsInventory
const MODELS_DELETE = 'models:delete' satisfies typeof Channel.modelsDelete
const MODELS_CANCEL = 'models:cancel' satisfies typeof Channel.modelsCancel
const MODELS_VALIDATE_DIR = 'models:validate-dir' satisfies typeof Channel.modelsValidateDir
const MODELS_PICK_DIR = 'models:pick-dir' satisfies typeof Channel.modelsPickDir
const OVERLAY_MOVE = 'overlay:move' satisfies typeof Channel.overlayMove
const OVERLAY_MOVE_STATE = 'overlay:move-state' satisfies typeof Channel.overlayMoveState
const APP_STATE = 'app:state' satisfies typeof Channel.appState
const NOTICE = 'app:notice' satisfies typeof Channel.appNotice

const api: SettingsApi = {
  getSettings: () => ipcRenderer.invoke(GET),
  updateSettings: (patch) => ipcRenderer.invoke(UPDATE, patch),
  resetSettings: () => ipcRenderer.invoke(RESET),
  exportSettings: () => ipcRenderer.invoke(EXPORT),
  importSettings: () => ipcRenderer.invoke(IMPORT),
  modelCatalog: () => ipcRenderer.invoke(MODELS_CATALOG),
  modelStatus: (from, to, scope) => ipcRenderer.invoke(MODELS_STATUS, from, to, scope),
  downloadModels: (from, to, scope) => ipcRenderer.invoke(MODELS_DOWNLOAD, from, to, scope),
  modelInventory: () => ipcRenderer.invoke(MODELS_INVENTORY),
  deleteModel: (id) => ipcRenderer.invoke(MODELS_DELETE, id),
  cancelDownload: () => ipcRenderer.invoke(MODELS_CANCEL),
  validateModelsDir: (path) => ipcRenderer.invoke(MODELS_VALIDATE_DIR, path),
  pickModelsDir: () => ipcRenderer.invoke(MODELS_PICK_DIR),
  moveOverlay: (active) => ipcRenderer.invoke(OVERLAY_MOVE, active),
  onMoveState(listener) {
    ipcRenderer.on(OVERLAY_MOVE_STATE, (_event, active: boolean) => listener(active))
  },
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
