import type {
  AudioLevelEvent,
  CacheStatsInfo,
  EngineOptions,
  ErrorEvent,
  InstalledModelInfo,
  LangPair,
  ModeEvent,
  ModelCatalog,
  ModelInventory,
  ModelProgressEvent,
  ModelRoleInfo,
  ModelStatusInfo,
  ModelsDirCheck,
  PerformanceOptions,
  Rect,
  SubtitleEvent,
  TranslationEvent,
} from './index'

export type {
  AudioLevelEvent,
  CacheStatsInfo,
  EngineOptions,
  ErrorEvent,
  InstalledModelInfo,
  LangPair,
  ModeEvent,
  ModelCatalog,
  ModelInventory,
  ModelProgressEvent,
  ModelRoleInfo,
  ModelStatusInfo,
  ModelsDirCheck,
  PerformanceOptions,
  Rect,
  SubtitleEvent,
  TranslationEvent,
}

/** Cancela la suscripción. */
export type Unsubscribe = () => void

/**
 * Aplica opciones al motor (en el próximo arranque) y detiene lo que esté en marcha, salvo la escucha
 * previa del nivel (`startAudioMonitor`), que pasa al motor nuevo.
 * Si alguna opción es inválida lanza un error con `code === 'InvalidArg'` y no cambia nada.
 */
export function configure(options?: EngineOptions): void

/**
 * Traduce el texto de una región. Reemplaza lo que estuviera en marcha.
 * Lanza un error con `code === 'InvalidArg'` si la región o los idiomas no son válidos, y un error
 * descriptivo si faltan modelos (motores reales) o un motor no está disponible en este build.
 */
export function startRegionTranslation(rect: Rect, from: string, to: string): void

/**
 * Subtitula el audio del sistema (captura del dispositivo de salida -> voz a texto -> traducción).
 * Con `engines: 'real'` necesita los modelos de `scope: 'audio'` descargados. Reemplaza lo que
 * estuviera en marcha. Los subtítulos llegan por `onSubtitle`: parciales (sin traducir) mientras
 * se habla y un final traducido al cerrar la frase.
 */
export function startAudioSubtitles(from: string, to: string, source?: AudioSourceSelection): void

/** Fuente de audio: todo el sistema o una aplicación (id de proceso y nombre de programa). */
export type AudioSourceSelection =
  | { kind: 'system' }
  | { kind: 'app'; id: number; name: string }

/** Aplicación que está reproduciendo audio. */
export interface AudioApp {
  id: number
  name: string
}

/** Lista de fuentes: `supported: false` si la plataforma no puede listar aplicaciones (con el motivo). */
export type AudioSourceList =
  | { supported: true; apps: AudioApp[] }
  | { supported: false; reason: string }

/**
 * Aplicaciones que reproducen audio ahora. Síncrona. Nunca lanza: un fallo de la plataforma se
 * informa como `{ supported: false, reason }`.
 */
export function listAudioSources(): AudioSourceList

/** Umbral de voz del motor (RMS, 0 a 1), para dibujar su marca en la barra de nivel. */
export function audioVoiceThreshold(): number

/**
 * Escucha previa del nivel: abre `source` (por defecto, todo el sistema) solo para medirlo, sin sesión
 * ni modelos ni conservar el audio; los niveles llegan por `onAudioLevel`. Reemplaza una escucha anterior.
 * Devuelve `false`, sin abrir nada, si hay una sesión en marcha (la escucha cede ante ella). Lanza con el
 * motivo si la fuente no se puede abrir, y con `code === 'InvalidArg'` si no es válida.
 */
export function startAudioMonitor(source?: AudioSourceSelection): boolean

/** Detiene la escucha previa; no llega ningún nivel más de ella. Es idempotente. */
export function stopAudioMonitor(): void

/** Detiene el motor. Tras volver no llega ningún evento más de la sesión. Es idempotente. */
export function stop(): void

/** Pausa la traducción de región; no hace nada si no hay una en marcha. */
export function pause(): void

/** Reanuda tras una pausa, en el modo previo. */
export function resume(): void

/** Idiomas con OCR y pares de traducción disponibles según el manifiesto de modelos. */
export function modelCatalog(): ModelCatalog

/** Qué modelos del par se consultan o descargan: texto en pantalla, audio o ambos. */
export type ModelScope = 'text' | 'audio' | 'all'

/**
 * Estado de los modelos necesarios para el par (`scope`: `text` por defecto, `audio` o `all`).
 * Rechaza si el par no está soportado.
 */
export function modelStatus(from: string, to: string, scope?: ModelScope): Promise<ModelStatusInfo[]>

/**
 * Descarga los modelos que falten para el par; el avance llega por `onModelProgress`, también
 * sin traducción en marcha. Rechaza con un error descriptivo si falla o el par no está soportado.
 */
export function downloadModels(from: string, to: string, scope?: ModelScope): Promise<void>

/** Todos los modelos del manifiesto con su estado, el espacio que ocupan en disco y el total. */
export function modelInventory(): Promise<ModelInventory>

/**
 * Borra un modelo (por su identificador del manifiesto) y devuelve los bytes liberados. Rechaza si
 * hay una traducción en marcha, si el modelo se está descargando o si el id no existe.
 */
export function deleteModel(id: string): Promise<number>

/** Interrumpe la descarga de modelos en curso (lo descargado se conserva para reanudar). */
export function cancelModelDownload(): Promise<void>

/** Comprueba si una ruta sirve como carpeta de modelos; `reason` explica por qué no. */
export function validateModelsDir(path: string): ModelsDirCheck

/**
 * Contadores de la caché de traducciones del motor actual (aciertos, fallos, inserciones,
 * desalojos y fracción de aciertos). Solo números; se reinician con `configure`.
 */
export function cacheStats(): CacheStatsInfo

export function onTranslation(listener: (event: TranslationEvent) => void): Unsubscribe
export function onSubtitle(listener: (event: SubtitleEvent) => void): Unsubscribe
export function onError(listener: (event: ErrorEvent) => void): Unsubscribe
export function onModelProgress(listener: (event: ModelProgressEvent) => void): Unsubscribe
export function onModeChanged(listener: (event: ModeEvent) => void): Unsubscribe
/** Nivel `{ rms, peak }` (0 a 1) de cada trozo de 100 ms de audio capturado, también en silencio, en una sesión o en la escucha previa. Solo números. */
export function onAudioLevel(listener: (event: AudioLevelEvent) => void): Unsubscribe
