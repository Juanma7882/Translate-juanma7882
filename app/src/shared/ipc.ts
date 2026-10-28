// Contrato IPC entre el proceso principal y las ventanas de producto.
//
// Cada ventana recibe por su preload una API mínima y tipada (`window.trSelector`, `window.trOverlay`,
// `window.trSettings`); nunca ve `ipcRenderer`, Node ni el sistema de archivos. Solo viajan
// parámetros de control, texto de traducciones y metadatos.

import type { ModelCatalog, ModelInventory, ModelScope, ModelStatusInfo } from 'tr-bindings'

import type { ActiveMode } from './mode.ts'
import type { Settings, SettingsPatch, UpdateResult } from './settings.ts'

/** Rectángulo en píxeles de interfaz (DIP), relativo a la esquina de la ventana. */
export interface DipRect {
  x: number
  y: number
  width: number
  height: number
}

export const Channel = {
  selectorInit: 'selector:init',
  selectorConfirm: 'selector:confirm',
  selectorCancel: 'selector:cancel',
  overlayShow: 'overlay:show',
  overlayStyle: 'overlay:style',
  overlayClear: 'overlay:clear',
  overlayMode: 'overlay:mode',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  modelsCatalog: 'models:catalog',
  modelsStatus: 'models:status',
  modelsDownload: 'models:download',
  modelsProgress: 'models:progress',
  modelsInventory: 'models:inventory',
  modelsDelete: 'models:delete',
  modelsCancel: 'models:cancel',
  modelsValidateDir: 'models:validate-dir',
  modelsPickDir: 'models:pick-dir',
  settingsReset: 'settings:reset',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  overlayMove: 'overlay:move',
  overlayMoveState: 'overlay:move-state',
  overlayMoveMode: 'overlay:move-mode',
  overlayDrag: 'overlay:drag',
  overlayMoveDone: 'overlay:move-done',
  appState: 'app:state',
  appNotice: 'app:notice',
} as const

// --------------------------------------------------------------------------------- selector

export interface SelectorInit {
  /** Última región elegida, ya convertida a píxeles de interfaz de este monitor. */
  lastRegion: DipRect | null
}

export interface SelectorApi {
  onInit(listener: (init: SelectorInit) => void): void
  confirm(rect: DipRect): void
  cancel(): void
}

// ---------------------------------------------------------------------------------- overlay

/** Texto a mostrar. `final: false` marca un subtítulo provisional. */
export interface OverlayText {
  original: string
  translated: string | null
  final: boolean
}

export interface OverlayStyle {
  opacity: number
  fontSize: number
  fontFamily: string
  showOriginal: boolean
  hideAfterMs: number
  textColor: string
  backgroundColor: string
  maxLines: number
}

export interface OverlayApi {
  onShow(listener: (text: OverlayText) => void): void
  onStyle(listener: (style: OverlayStyle) => void): void
  onClear(listener: () => void): void
  /** Modo activo (solo su nombre, nunca contenido). */
  onMode(listener: (mode: OverlayMode) => void): void
  /** Entra o sale del modo "mover": el overlay deja de ser atravesable y muestra un asa. */
  onMoveMode(listener: (active: boolean) => void): void
  /** Desplazamiento del arrastre en píxeles de interfaz; solo se atiende en modo mover. */
  drag(dx: number, dy: number): void
  /** Termina el modo mover y guarda la posición. */
  endMove(): void
}

// ---------------------------------------------------------------------------------- settings

export type ModelProgress = { model: string; downloaded: number; total: number | null }

/** Modo que se muestra en el overlay. */
export type OverlayMode = ActiveMode | 'paused'

/** `mode` es el modo activo de la sesión en marcha (`null` en reposo); en pausa conserva el último. */
export type AppState = { running: boolean; paused: boolean; mode: ActiveMode | null }

/** Aviso para el usuario: describe qué pasó, nunca incluye texto capturado ni traducido. */
export interface Notice {
  level: 'info' | 'warning' | 'error'
  message: string
  /** Identifica avisos con una acción asociada (p. ej. `models-missing` ofrece descargarlos). */
  code?: 'models-missing'
}

/** Por qué no se pudo borrar un modelo. */
export type DeleteFailure = 'running' | 'downloading' | 'unknown' | 'failed'

export type DeleteResult = { ok: true; freed: number } | { ok: false; reason: DeleteFailure }

/** Por qué una carpeta de modelos no sirve (códigos del motor, más `running` si hay una sesión). */
export type DirFailure = 'not-absolute' | 'parent-references' | 'root' | 'not-a-folder' | 'not-writable' | 'running' | 'empty'

export type DirCheck = { ok: true } | { ok: false; reason: DirFailure }

/** Resultado de exportar o importar preferencias. `canceled`: el usuario cerró el diálogo. */
export type TransferResult = { ok: true; settings?: Settings } | { ok: false; canceled?: boolean; errors?: string[] }

export interface SettingsApi {
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<UpdateResult>
  /** Restablece las preferencias (conserva la región y la carpeta de modelos). */
  resetSettings(): Promise<UpdateResult>
  /** Guarda las preferencias en un archivo elegido por el usuario (sin región ni rutas). */
  exportSettings(): Promise<TransferResult>
  /** Lee unas preferencias de un archivo elegido por el usuario; todo o nada. */
  importSettings(): Promise<TransferResult>
  modelCatalog(): Promise<ModelCatalog>
  modelStatus(from: string, to: string, scope?: ModelScope): Promise<ModelStatusInfo[]>
  downloadModels(from: string, to: string, scope?: ModelScope): Promise<void>
  /** Todos los modelos con su espacio en disco. */
  modelInventory(): Promise<ModelInventory>
  deleteModel(id: string): Promise<DeleteResult>
  /** Cancela la descarga en curso (lo descargado se conserva para reanudar). */
  cancelDownload(): Promise<void>
  validateModelsDir(path: string): Promise<DirCheck>
  /** Diálogo del sistema para elegir carpeta; `null` si se cancela. */
  pickModelsDir(): Promise<string | null>
  /** Activa o desactiva el modo "mover overlay"; devuelve si quedó activo. */
  moveOverlay(active: boolean): Promise<boolean>
  onMoveState(listener: (active: boolean) => void): void
  onSettingsChanged(listener: (settings: Settings) => void): void
  onModelProgress(listener: (progress: ModelProgress) => void): void
  onAppState(listener: (state: AppState) => void): void
  onNotice(listener: (notice: Notice) => void): void
}

declare global {
  interface Window {
    trSelector?: SelectorApi
    trOverlay?: OverlayApi
    trSettings?: SettingsApi
  }
}
