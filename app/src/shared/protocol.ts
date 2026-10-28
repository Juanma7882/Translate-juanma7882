// Protocolo entre el proceso principal y el proceso utilitario que aloja el motor nativo.
// Solo viajan parámetros de control y texto/metadatos; nunca píxeles ni audio.

import type {
  EngineOptions,
  ErrorEvent,
  ModeEvent,
  ModelCatalog,
  ModelInventory,
  ModelProgressEvent,
  ModelScope,
  ModelStatusInfo,
  ModelsDirCheck,
  Rect,
  SubtitleEvent,
  TranslationEvent,
} from 'tr-bindings'

import type { AudioLevel, AudioSourcesInfo } from './ipc.ts'

export interface EngineEventMap {
  translation: TranslationEvent
  subtitle: SubtitleEvent
  error: ErrorEvent
  modelProgress: ModelProgressEvent
  mode: ModeEvent
  audioLevel: AudioLevel
}

export type EngineEventName = keyof EngineEventMap

export type EngineEvent = {
  [K in EngineEventName]: { name: K; payload: EngineEventMap[K] }
}[EngineEventName]

/** Fuente de audio que entiende el motor: `id` sale de `listAudioSources`. */
export type AudioSourceRequest = { kind: 'system' } | { kind: 'app'; id: number; name: string }

/** Órdenes de main hacia el motor. */
export type Command =
  | { type: 'configure'; options: EngineOptions }
  | { type: 'startRegion'; rect: Rect; from: string; to: string[] }
  | { type: 'startAudio'; from: string; to: string[]; source?: AudioSourceRequest }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'modelCatalog' }
  | { type: 'modelStatus'; from: string; to: string[]; scope?: ModelScope }
  | { type: 'downloadModels'; from: string; to: string[]; scope?: ModelScope }
  | { type: 'modelInventory' }
  | { type: 'deleteModel'; modelId: string }
  | { type: 'cancelDownload' }
  | { type: 'validateModelsDir'; path: string }
  | { type: 'listAudioSources' }
  | { type: 'voiceThreshold' }
  | { type: 'startAudioMonitor'; source?: AudioSourceRequest }
  | { type: 'stopAudioMonitor' }

/** Qué devuelve cada orden al completarse. */
export type CommandResult<C extends Command> = C extends { type: 'modelStatus' }
  ? ModelStatusInfo[]
  : C extends { type: 'modelCatalog' }
    ? ModelCatalog
    : C extends { type: 'modelInventory' }
      ? ModelInventory
      : C extends { type: 'deleteModel' }
        ? number
        : C extends { type: 'validateModelsDir' }
          ? ModelsDirCheck
          : C extends { type: 'listAudioSources' }
            ? AudioSourcesInfo
            : C extends { type: 'voiceThreshold' }
              ? number
              : C extends { type: 'startAudioMonitor' }
                ? boolean
                : void

export type Request = Command & { id: number }

/** Mensajes del motor hacia main. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'reply'; id: number; value?: unknown; error?: string }
  | ({ type: 'event' } & EngineEvent)
