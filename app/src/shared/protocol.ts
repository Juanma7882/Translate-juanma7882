// Protocolo entre el proceso principal y el proceso utilitario que aloja el motor nativo.
// Solo viajan parámetros de control y texto/metadatos; nunca píxeles ni audio.

import type {
  EngineOptions,
  ErrorEvent,
  ModeEvent,
  ModelCatalog,
  ModelProgressEvent,
  ModelStatusInfo,
  Rect,
  SubtitleEvent,
  TranslationEvent,
} from 'tr-bindings'

export interface EngineEventMap {
  translation: TranslationEvent
  subtitle: SubtitleEvent
  error: ErrorEvent
  modelProgress: ModelProgressEvent
  mode: ModeEvent
}

export type EngineEventName = keyof EngineEventMap

export type EngineEvent = {
  [K in EngineEventName]: { name: K; payload: EngineEventMap[K] }
}[EngineEventName]

/** Órdenes de main hacia el motor. */
export type Command =
  | { type: 'configure'; options: EngineOptions }
  | { type: 'startRegion'; rect: Rect; from: string; to: string }
  | { type: 'startAudio'; from: string; to: string }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'modelCatalog' }
  | { type: 'modelStatus'; from: string; to: string }
  | { type: 'downloadModels'; from: string; to: string }

/** Qué devuelve cada orden al completarse. */
export type CommandResult<C extends Command> = C extends { type: 'modelStatus' }
  ? ModelStatusInfo[]
  : C extends { type: 'modelCatalog' }
    ? ModelCatalog
    : void

export type Request = Command & { id: number }

/** Mensajes del motor hacia main. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'reply'; id: number; value?: unknown; error?: string }
  | ({ type: 'event' } & EngineEvent)
