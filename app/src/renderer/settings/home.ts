// Lógica pura de la pestaña Inicio: controles por fase, textos de estado, opciones de fuente de audio,
// escala y caída de la barra de nivel y avisos de audio bajo o ausente. Sin DOM ni reloj propio: el tiempo se inyecta.

import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { AudioLevel, AudioSourceChoice, AudioSourcesInfo, MonitorState, SessionPhase } from '../../shared/ipc.ts'
import { MODE_LABELS, needsRegion } from '../../shared/mode.ts'
import type { ActiveMode, Mode } from '../../shared/mode.ts'
import type { SavedRegion } from '../../shared/settings.ts'

// ------------------------------------------------------------------------------------ fase

/** Lo mínimo del estado de la app que usa esta pestaña (compatible con `AppState`). */
export interface PhaseSource {
  running: boolean
  paused: boolean
  phase?: SessionPhase
  waitingFor?: string
}

/** Fase de la sesión; si el main aún no la informa, se deduce de `running`/`paused`. */
export function phaseOf(state: PhaseSource): SessionPhase {
  if (state.phase) return state.phase
  if (!state.running) return 'idle'
  return state.paused ? 'paused' : 'running'
}

// --------------------------------------------------------------------------------- controles

export interface Controls {
  start: boolean
  pause: boolean
  restart: boolean
  stop: boolean
  /** El botón de pausa pausa o reanuda según la fase. */
  pauseLabel: 'Pausar' | 'Reanudar'
  pauseAction: 'pause' | 'resume'
}

/** Qué botones están habilitados en cada fase. Durante `starting` solo se puede detener. */
export function controlsFor(phase: SessionPhase): Controls {
  const base = { pauseLabel: 'Pausar', pauseAction: 'pause' } as const
  switch (phase) {
    case 'idle':
    case 'error':
      return { ...base, start: true, pause: false, restart: false, stop: false }
    case 'starting':
      return { ...base, start: false, pause: false, restart: false, stop: true }
    case 'running':
      return { ...base, start: false, pause: true, restart: true, stop: true }
    case 'paused':
      return { start: false, pause: true, restart: true, stop: true, pauseLabel: 'Reanudar', pauseAction: 'resume' }
    case 'waiting':
      return { ...base, start: false, pause: false, restart: true, stop: true }
  }
}

/** Mientras una orden está pendiente solo queda disponible Detener (si la fase lo permite). */
export function withPending(controls: Controls, pending: boolean): Controls {
  if (!pending) return controls
  return { ...controls, start: false, pause: false, restart: false }
}

// -------------------------------------------------------------------------------------- texto

export function phaseLabel(phase: SessionPhase, waitingFor?: string): string {
  switch (phase) {
    case 'idle':
      return 'En reposo'
    case 'starting':
      return 'Iniciando…'
    case 'running':
      return 'Traduciendo'
    case 'paused':
      return 'En pausa'
    case 'waiting':
      return waitingFor ? `Esperando a ${waitingFor}` : 'Esperando a la aplicación elegida'
    case 'error':
      return 'Error: la sesión se detuvo'
  }
}

/** Modo que se muestra: el activo de la sesión si hay, o el elegido en Ajustes. */
export function modeLabel(active: ActiveMode | null, chosen: Mode): string {
  if (active) return active === 'text' ? 'Texto' : 'Audio'
  return MODE_LABELS[chosen]
}

export function sourceLabel(choice: AudioSourceChoice): string {
  return choice.kind === 'system' ? 'Todo el sistema' : choice.program
}

/** Frase completa para la región `aria-live`. */
export function statusSentence(phase: SessionPhase, waitingFor: string | undefined, mode: string, source: string): string {
  return `${phaseLabel(phase, waitingFor)}. Modo: ${mode}. Fuente de audio: ${source}.`
}

// ------------------------------------------------------------------------------------ fuentes

const SYSTEM_VALUE = 'system'

export function choiceToValue(choice: AudioSourceChoice): string {
  return choice.kind === 'system' ? SYSTEM_VALUE : `app:${choice.program}`
}

export function valueToChoice(value: string): AudioSourceChoice {
  return value.startsWith('app:') && value.length > 4 ? { kind: 'app', program: value.slice(4) } : { kind: 'system' }
}

export interface SourceOption {
  value: string
  label: string
}

export interface SourceOptions {
  options: SourceOption[]
  /** Por qué solo hay "Todo el sistema" o qué falló al consultar; `null` si todo va bien. */
  note: string | null
}

export const SOURCES_ERROR = 'No se pudo consultar las aplicaciones'

/**
 * Opciones del selector. `info === null` es "aún sin datos" y `error` que la consulta falló.
 * La aplicación elegida se muestra siempre, aunque no esté sonando.
 */
export function sourceOptions(info: AudioSourcesInfo | null, chosen: AudioSourceChoice, error = false): SourceOptions {
  const options: SourceOption[] = [{ value: SYSTEM_VALUE, label: 'Todo el sistema' }]
  const names = new Set<string>()
  let note: string | null = null
  if (info && info.supported) {
    for (const app of info.apps) {
      if (names.has(app.name)) continue
      names.add(app.name)
      options.push({ value: `app:${app.name}`, label: app.name })
    }
  } else if (info && !info.supported) {
    note = `Solo está disponible «Todo el sistema»: ${info.reason}`
  }
  if (error) note = SOURCES_ERROR
  if (chosen.kind === 'app' && !names.has(chosen.program)) {
    const why = info && !info.supported ? 'no disponible' : 'no está sonando'
    options.push({ value: choiceToValue(chosen), label: `${chosen.program} (${why})` })
  }
  return { options, note }
}

/** Lee la fuente de los ajustes; sin el campo (versiones antiguas) es todo el sistema. */
export function audioSourceOf(settings: object): AudioSourceChoice {
  const raw = (settings as { audioSource?: AudioSourceChoice }).audioSource
  return raw && raw.kind === 'app' && raw.program ? raw : { kind: 'system' }
}

// ------------------------------------------------------------------------------------- nivel

/** Suelo de la escala: por debajo de -60 dBFS la barra está vacía. */
export const FLOOR_DB = -60

/** RMS (0..1) a porcentaje (0..100) en escala perceptual: dBFS entre -60 y 0. */
export function levelToPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const db = 20 * Math.log10(Math.min(value, 1))
  return Math.max(0, Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100))
}

/** Velocidad de caída de la barra, en puntos porcentuales por segundo. */
export const FALL_PER_SECOND = 90

/** Sube de inmediato y baja suavemente: `prev` es lo mostrado; `target`, el último nivel; `dtMs`, el tiempo transcurrido. */
export function smoothLevel(prev: number, target: number, dtMs: number, fallPerSecond = FALL_PER_SECOND): number {
  if (target >= prev) return target
  return Math.max(target, prev - (fallPerSecond * Math.max(0, dtMs)) / 1000)
}

export function meterText(percent: number, aboveThreshold: boolean): string {
  const rounded = Math.round(percent)
  if (rounded === 0) return 'Sin señal, 0 %'
  return `Nivel ${rounded} %, ${aboveThreshold ? 'voz detectable' : 'por debajo del umbral de voz'}`
}

// ------------------------------------------------------------------------------------ avisos

export interface LevelSample {
  /** Marca de tiempo en ms (la misma base que `now`). */
  t: number
  rms: number
  peak: number
}

export type LevelAdvice = 'low' | 'none' | null

export const ADVICE_TEXT: Record<'low' | 'none', string> = {
  low: 'El audio llega demasiado bajo: sube el volumen de la fuente.',
  none: 'No llega audio de la fuente elegida. Comprueba que suena y que es la fuente correcta.',
}

/** Ventana durante la que debe mantenerse la situación antes de avisar. */
export const ADVICE_WINDOW_MS = 5000
/** Por debajo de esto el nivel cuenta como cero. */
export const SILENCE = 1e-4
/** Si el último nivel es más viejo que esto, no se opina (el flujo se cortó). */
const STALE_MS = 1500

export interface AdviceOptions {
  /** Solo hay avisos con captura en marcha: una sesión traduciendo o la escucha previa. */
  running?: boolean
  windowMs?: number
}

/**
 * Decide el aviso a partir del historial reciente. Exige que el historial cubra toda la ventana
 * (la sesión lleva al menos `windowMs` emitiendo niveles) y que el último nivel sea reciente.
 */
export function levelAdvice(history: readonly LevelSample[], threshold: number, now: number, options: AdviceOptions = {}): LevelAdvice {
  const { running = true, windowMs = ADVICE_WINDOW_MS } = options
  if (!running || history.length === 0) return null
  const recent = history.filter((s) => now - s.t <= windowMs)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last) return null
  if (now - last.t > STALE_MS) return null
  // Cobertura: la muestra más antigua de la ventana debe estar cerca de su inicio.
  if (now - first.t < windowMs - STALE_MS) return null
  const maxRms = Math.max(...recent.map((s) => s.rms))
  const maxPeak = Math.max(...recent.map((s) => s.peak))
  if (maxRms <= SILENCE && maxPeak <= SILENCE) return 'none'
  if (maxRms < threshold) return 'low'
  return null
}

// -------------------------------------------------------------------------------------- almacén

/** Guarda el último nivel y un historial corto; la interfaz lo consulta sin re-renderizar a 15 Hz. */
export interface LevelStore {
  push(level: AudioLevel): void
  /** Último nivel recibido (rms) o 0. */
  latest(): number
  history(): readonly LevelSample[]
  clear(): void
}

export function createLevelStore(clock: () => number = Date.now, keepMs = 2 * ADVICE_WINDOW_MS): LevelStore {
  let samples: LevelSample[] = []
  return {
    push(level) {
      const t = clock()
      samples.push({ t, rms: level.rms, peak: level.peak })
      const cutoff = t - keepMs
      if (samples[0] && samples[0].t < cutoff) samples = samples.filter((s) => s.t >= cutoff)
    },
    latest() {
      const last = samples[samples.length - 1]
      return last && clock() - last.t <= STALE_MS ? last.rms : 0
    },
    history: () => samples,
    clear() {
      samples = []
    },
  }
}

// ------------------------------------------------------------------------------ primer uso

export type GuideStepId = 'language' | 'region' | 'start'

export interface GuideStep {
  id: GuideStepId
  label: string
  done: boolean
}

export interface FirstRunInput {
  mode: Mode
  hasRegion: boolean
  /** ¿Están instalados los modelos del par activo para este modo? */
  modelsReady: boolean
  /** ¿Se ha visto alguna vez una sesión en marcha? */
  hasEverStarted: boolean
}

export interface FirstRun {
  steps: GuideStep[]
  /** Primer paso pendiente (el que se destaca); `null` si todos están hechos. */
  current: GuideStepId | null
  complete: boolean
}

/** Pasos del primer uso. Cada uno se cumple por su condición real, en cualquier orden; en solo audio no hay región. */
export function firstRunSteps(input: FirstRunInput): FirstRun {
  const steps: GuideStep[] = [
    {
      id: 'language',
      label: input.mode === 'audio' ? 'Descarga el idioma con sus modelos de audio' : input.mode === 'auto' ? 'Descarga el idioma con sus modelos de texto y de audio' : 'Descarga un idioma',
      done: input.modelsReady,
    },
  ]
  if (needsRegion(input.mode)) steps.push({ id: 'region', label: 'Elige la región de la pantalla', done: input.hasRegion })
  steps.push({ id: 'start', label: 'Inicia la traducción', done: input.hasEverStarted })
  const pending = steps.find((s) => !s.done)
  return { steps, current: pending ? pending.id : null, complete: pending === undefined }
}

// ---------------------------------------------------------------------- región y modo

export interface RegionSummary {
  text: string
  /** ¿Se puede (y tiene sentido) elegir una región en este modo? */
  canChange: boolean
  buttonLabel: 'Elegir región' | 'Cambiar región'
}

export function regionSummary(region: SavedRegion | null, mode: Mode): RegionSummary {
  if (!needsRegion(mode)) return { text: 'Este modo no necesita región: traduce el audio del sistema.', canChange: false, buttonLabel: 'Elegir región' }
  if (!region) return { text: 'Falta elegir la región de la pantalla con el texto a traducir.', canChange: true, buttonLabel: 'Elegir región' }
  const screen = region.monitor > 0 ? `, pantalla ${region.monitor + 1}` : ''
  return { text: `${region.width} × ${region.height} px, en (${region.x}, ${region.y})${screen}`, canChange: true, buttonLabel: 'Cambiar región' }
}

export function modeSentence(mode: Mode): string {
  switch (mode) {
    case 'auto':
      return 'Traduce el texto de la región y, si no hay texto, el audio del sistema; vuelve al texto cuando reaparece.'
    case 'text':
      return 'Solo traduce el texto de la región elegida.'
    case 'audio':
      return 'Solo subtitula el audio del sistema; no necesita región.'
  }
}

// ------------------------------------------------------------------- pares instalados

export interface PairRef {
  from: string
  to: string
}

export const pairKey = (from: string, to: string): string => `${from}>${to}`

/**
 * Pares del catálogo con todos sus modelos listos (los estados ya vienen pedidos para el ámbito del modo).
 * Un par sin estados todavía (aún cargando) o con alguno sin instalar no cuenta.
 */
export function installedPairs(catalog: ModelCatalog | null, statusesByPair: Readonly<Record<string, readonly ModelStatusInfo[]>>): PairRef[] {
  if (!catalog) return []
  return catalog.pairs
    .filter((p) => {
      const list = statusesByPair[pairKey(p.from, p.to)]
      return list !== undefined && list.length > 0 && list.every((s) => s.state === 'ready')
    })
    .map((p) => ({ from: p.from, to: p.to }))
    .sort((a, b) => pairKey(a.from, a.to).localeCompare(pairKey(b.from, b.to)))
}

// ------------------------------------------------------------------------ memoria de la guía

/** Lo único que se usa de `localStorage`; inyectable para probarlo sin navegador. */
export interface FlagStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const GUIDE_DONE_KEY = 'translate.guide.done'
export const GUIDE_STARTED_KEY = 'translate.guide.started'

/** Lee una marca; cualquier fallo del almacén (bloqueado, ausente) cuenta como «no marcada». */
export function readFlag(store: FlagStore | null, key: string): boolean {
  try {
    return store?.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Guarda una marca; si el almacén falla, la guía solo pierde la memoria y nunca rompe la ventana. */
export function writeFlag(store: FlagStore | null, key: string): void {
  try {
    store?.setItem(key, '1')
  } catch {
    // sin almacenamiento: se recalcula en cada apertura
  }
}

// ------------------------------------------------------------------------- escucha previa

/** Qué pasa con la barra de nivel: de dónde sale su señal y qué se le dice al usuario. */
export type MeterStatus =
  /** Una sesión traduciendo: el nivel viene de ella. */
  | { kind: 'session' }
  /** Sin sesión y midiendo la fuente elegida (escucha previa). */
  | { kind: 'listening'; source: string }
  | { kind: 'starting' }
  | { kind: 'waiting'; program: string }
  | { kind: 'error'; reason: string }
  /** «Solo texto»: el audio no se usa. */
  | { kind: 'text-mode' }
  /** Nada que decir: la barra queda a cero. */
  | { kind: 'idle' }

export interface MeterStatusInput {
  phase: SessionPhase
  mode: Mode
  monitor: MonitorState
  source: AudioSourceChoice
}

/**
 * Con la sesión traduciendo manda la sesión; iniciando, en pausa o esperando la barra queda a cero; en reposo (o tras un
 * error de la sesión) manda la escucha previa, salvo en «Solo texto», donde el audio no se usa.
 */
export function meterStatus({ phase, mode, monitor, source }: MeterStatusInput): MeterStatus {
  if (phase === 'running') return { kind: 'session' }
  if (phase !== 'idle' && phase !== 'error') return { kind: 'idle' }
  if (mode === 'text') return { kind: 'text-mode' }
  switch (monitor.phase) {
    case 'listening':
      return { kind: 'listening', source: sourceLabel(source) }
    case 'starting':
      return { kind: 'starting' }
    case 'waiting':
      return { kind: 'waiting', program: monitor.program }
    case 'error':
      return { kind: 'error', reason: monitor.reason }
    case 'idle':
      return { kind: 'idle' }
  }
}

/** ¿Hay una captura midiendo, de la sesión o de la escucha previa? Entonces la barra se anima y los avisos valen. */
export function meterLive(status: MeterStatus): boolean {
  return status.kind === 'session' || status.kind === 'listening'
}

/** Texto bajo la barra; vacío si no hay nada que decir. */
export function meterNote(status: MeterStatus): string {
  switch (status.kind) {
    case 'listening':
      return `Escuchando «${status.source}» para mostrar el nivel. No se guarda ni se traduce nada hasta que pulses Iniciar.`
    case 'starting':
      return 'Abriendo la fuente de audio…'
    case 'waiting':
      return `Esperando a que suene ${status.program} para mostrar su nivel.`
    case 'error':
      return `No se pudo escuchar el audio: ${status.reason}`
    case 'text-mode':
      return 'El modo «Solo texto» no usa el audio, así que la barra no se mueve.'
    case 'session':
    case 'idle':
      return ''
  }
}
