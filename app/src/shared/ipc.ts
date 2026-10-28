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
  selectorNextDisplay: 'selector:next-display',
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
  // Ventana principal (pestaña Inicio): controles de sesión y fuente de audio.
  sessionStart: 'session:start',
  sessionPause: 'session:pause',
  sessionResume: 'session:resume',
  sessionRestart: 'session:restart',
  sessionStop: 'session:stop',
  sessionChooseRegion: 'session:choose-region',
  sessionShowRegion: 'session:show-region',
  sessionPickRegion: 'session:pick-region',
  sessionPickOverlayPosition: 'session:pick-overlay-position',
  sessionShowOverlayPosition: 'session:show-overlay-position',
  sessionState: 'session:state',
  audioSources: 'audio:sources',
  audioLevel: 'audio:level',
  audioVoiceThreshold: 'audio:voice-threshold',
  audioWatch: 'audio:watch',
  audioMonitorState: 'audio:monitor-state',
} as const

// --------------------------------------------------------------------------------- selector

export interface SelectorInit {
  /** Última región elegida, ya convertida a píxeles de interfaz de este monitor. */
  lastRegion: DipRect | null
  /** Pantalla donde se abre el selector (1 = primera) y cuántas hay: con más de una se puede saltar de una a otra. */
  screen: { index: number; total: number }
  /** `true` solo enseña `lastRegion` unos segundos, sin aceptar ratón ni teclado. */
  preview?: boolean
}

export interface SelectorApi {
  onInit(listener: (init: SelectorInit) => void): void
  confirm(rect: DipRect): void
  cancel(): void
  /** Pasa el selector a la pantalla siguiente (la última da la vuelta a la primera). */
  nextDisplay(): void
}

// ---------------------------------------------------------------------------------- overlay

/** Texto a mostrar. `final: false` marca un subtítulo provisional. */
export interface OverlayText {
  original: string
  /** Idioma del original (el de origen de la sesión). */
  lang: string
  /** Una entrada por destino traducido, en el orden de los destinos (vacía si no hay traducciones). */
  translations: { lang: string; text: string }[]
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

/** Fuente de audio elegida; la aplicación se guarda por nombre de programa, no por PID. */
export type AudioSourceChoice = { kind: 'system' } | { kind: 'app'; program: string }

/** Aplicación que está sonando (solo metadatos). */
export interface AudioApp {
  id: number
  /** Nombre del programa, p. ej. `firefox.exe`. */
  name: string
}

/** Lista de aplicaciones con audio; `supported: false` si la plataforma no puede capturar por aplicación. */
export type AudioSourcesInfo = { supported: true; apps: AudioApp[] } | { supported: false; reason: string }

/** Nivel del audio capturado, de 0 a 1. Solo números. */
export interface AudioLevel {
  rms: number
  peak: number
}

/**
 * Escucha previa del nivel (la barra de Inicio antes de iniciar nada). `listening`: el motor mide la fuente elegida;
 * `waiting`: espera a que suene la aplicación elegida; `error`: no se pudo abrir la fuente (con el motivo);
 * `starting`: abriéndola; `idle`: no escucha (Inicio fuera de vista, sesión en marcha o modo «Solo texto»).
 */
export type MonitorState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'listening' }
  | { phase: 'waiting'; program: string }
  | { phase: 'error'; reason: string }

/**
 * `phase` es el estado de la sesión para la interfaz; `waitingFor` (nombre de programa) solo vale en la fase `waiting`.
 * `running` es verdadero con la sesión en marcha, en pausa o en espera de la aplicación elegida.
 */
export type AppState = { running: boolean; paused: boolean; mode: ActiveMode | null; phase: SessionPhase; waitingFor?: string }

/** Estado de la sesión para la interfaz. `starting`: el motor aún responde; `waiting`: espera a la aplicación elegida. */
export type SessionPhase = 'idle' | 'starting' | 'running' | 'paused' | 'waiting' | 'error'

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
  modelStatus(from: string, to: string[], scope?: ModelScope): Promise<ModelStatusInfo[]>
  downloadModels(from: string, to: string[], scope?: ModelScope): Promise<void>
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
  /** Controles de sesión (todas son seguras si se repiten). */
  startSession(): Promise<void>
  pauseSession(): Promise<void>
  resumeSession(): Promise<void>
  restartSession(): Promise<void>
  stopSession(): Promise<void>
  /** Abre el selector de región; si se elige una, se guarda y se empieza a traducir. Devuelve si se eligió. */
  chooseRegion(): Promise<boolean>
  /** Abre solo el selector de región (sin pasar a overlay). Devuelve si se eligió. */
  pickRegion(): Promise<boolean>
  /** Abre solo el selector de posición del overlay. Devuelve si se eligió. */
  pickOverlayPosition(): Promise<boolean>
  /** Marca unos segundos sobre la pantalla la región guardada. Devuelve `false` si no hay región o no se pudo mostrar. */
  showRegion(): Promise<boolean>
  /** Muestra dónde aparecerá el overlay durante unos segundos. Devuelve `false` si no hay región o no se pudo mostrar. */
  showOverlayPosition(): Promise<boolean>
  /** Estado actual de la sesión: al abrir la ventana con una sesión en marcha no hay que esperar a un cambio. */
  getAppState(): Promise<AppState>
  /** Aplicaciones con audio activo en este momento. */
  listAudioSources(): Promise<AudioSourcesInfo>
  /** Nivel del audio a 15 Hz como máximo; solo el último valor importa. */
  onAudioLevel(listener: (level: AudioLevel) => void): void
  /** Umbral RMS a partir del cual el audio cuenta como voz (marca de la barra). */
  voiceThreshold(): Promise<number>
  /**
   * Declara si Inicio está a la vista. Mientras lo esté, sin sesión y fuera del modo «Solo texto», el motor mide el nivel
   * de la fuente elegida para mover la barra aunque no se haya iniciado nada. Devuelve el estado de la escucha.
   */
  watchAudioLevel(on: boolean): Promise<MonitorState>
  /** Cambios de estado de la escucha previa. */
  onMonitorState(listener: (state: MonitorState) => void): void
}

declare global {
  interface Window {
    trSelector?: SelectorApi
    trOverlay?: OverlayApi
    trSettings?: SettingsApi
  }
}
