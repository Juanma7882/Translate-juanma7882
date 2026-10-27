// Contrato IPC entre el proceso principal y las ventanas de producto.
//
// Cada ventana recibe por su preload una API mínima y tipada (`window.trSelector`, `window.trOverlay`,
// `window.trSettings`); nunca ve `ipcRenderer`, Node ni el sistema de archivos. Solo viajan
// parámetros de control, texto de traducciones y metadatos.

import type { ModelCatalog, ModelScope, ModelStatusInfo } from 'tr-bindings'

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
}

export interface OverlayApi {
  onShow(listener: (text: OverlayText) => void): void
  onStyle(listener: (style: OverlayStyle) => void): void
  onClear(listener: () => void): void
  /** Modo activo (solo su nombre, nunca contenido). */
  onMode(listener: (mode: OverlayMode) => void): void
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

export interface SettingsApi {
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<UpdateResult>
  modelCatalog(): Promise<ModelCatalog>
  modelStatus(from: string, to: string, scope?: ModelScope): Promise<ModelStatusInfo[]>
  downloadModels(from: string, to: string, scope?: ModelScope): Promise<void>
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
