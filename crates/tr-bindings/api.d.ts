import type {
  EngineOptions,
  ErrorEvent,
  ModeEvent,
  ModelProgressEvent,
  Rect,
  SubtitleEvent,
  TranslationEvent,
} from './index'

export type {
  EngineOptions,
  ErrorEvent,
  ModeEvent,
  ModelProgressEvent,
  Rect,
  SubtitleEvent,
  TranslationEvent,
}

/** Cancela la suscripción. */
export type Unsubscribe = () => void

/** Aplica opciones al motor (en el próximo arranque). Detiene lo que esté en marcha. */
export function configure(options?: EngineOptions): void

/**
 * Traduce el texto de una región. Reemplaza lo que estuviera en marcha.
 * Lanza un error con `code === 'InvalidArg'` si la región o los idiomas no son válidos.
 */
export function startRegionTranslation(rect: Rect, from: string, to: string): void

/** Subtitula el audio del sistema. Reemplaza lo que estuviera en marcha. */
export function startAudioSubtitles(from: string, to: string): void

/** Detiene el motor. Tras volver no llega ningún evento más. Es idempotente. */
export function stop(): void

export function onTranslation(listener: (event: TranslationEvent) => void): Unsubscribe
export function onSubtitle(listener: (event: SubtitleEvent) => void): Unsubscribe
export function onError(listener: (event: ErrorEvent) => void): Unsubscribe
export function onModelProgress(listener: (event: ModelProgressEvent) => void): Unsubscribe
export function onModeChanged(listener: (event: ModeEvent) => void): Unsubscribe
