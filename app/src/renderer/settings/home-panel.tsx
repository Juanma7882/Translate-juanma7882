// Pestaña Inicio: estado de la sesión, controles, fuente de audio y barra de nivel.
// La lógica (habilitación de botones, escala, avisos) vive en `home.ts`, que es pura y está probada.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { ModelCatalog } from 'tr-bindings'

import type { AppState, AudioSourcesInfo, Notice, SettingsApi } from '../../shared/ipc.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import { formatBytes, languagesSummary, summarize } from './form.ts'
import type { DownloadProgress } from './form.ts'
import {
  ADVICE_TEXT,
  audioSourceOf,
  choiceToValue,
  controlsFor,
  levelAdvice,
  levelToPercent,
  meterLive,
  meterNote,
  meterStatus,
  meterText,
  modeLabel,
  phaseOf,
  smoothLevel,
  sourceLabel,
  sourceOptions,
  statusSentence,
  valueToChoice,
  withPending,
  SOURCES_ERROR,
} from './home.ts'
import type { LevelAdvice, LevelStore, MeterStatus } from './home.ts'
import { useAudioWatch } from './audio-watch.ts'
import { scopeForMode } from '../../shared/mode.ts'
import { ModeRow, PairMenu, RegionRow } from './quick-setup.tsx'
import { StartGuide } from './start-guide.tsx'

/** Cada cuánto se refresca la lista de aplicaciones mientras la pestaña está a la vista. */
const REFRESH_MS = 3000

interface Props {
  api: SettingsApi
  settings: Settings
  appState: AppState
  notice: Notice | null
  levels: LevelStore
  catalog: ModelCatalog | null
  progress: DownloadProgress
  /** ¿Está la pestaña Inicio seleccionada? Fuera de ella no se consulta ni se anima nada. */
  active: boolean
  save: (patch: SettingsPatch) => Promise<boolean>
  goToLanguages: () => void
}

type Action = 'start' | 'pause' | 'resume' | 'restart' | 'stop' | 'region'

export function HomePanel({ api, settings, appState, notice, levels, catalog, progress, active, save, goToLanguages }: Props) {
  const phase = phaseOf(appState)
  const waitingFor = appState.waitingFor
  const choice = audioSourceOf(settings)
  // Con Inicio a la vista y sin sesión, main mide la fuente elegida para que la barra se mueva sin pulsar Iniciar.
  const monitor = useAudioWatch(api, active)
  const meter = meterStatus({ phase, mode: settings.mode, monitor, source: choice })
  const [pending, setPending] = useState<Action | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const controls = withPending(controlsFor(phase), pending !== null)

  const run = async (action: Action) => {
    setFailure(null)
    setPending(action)
    try {
      if (action === 'start') await api.startSession()
      else if (action === 'pause') await api.pauseSession()
      else if (action === 'resume') await api.resumeSession()
      else if (action === 'restart') await api.restartSession()
      else if (action === 'region') await api.chooseRegion()
      else await api.stopSession()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    }
    setPending(null)
  }

  const running = appState.running
  return (
    <>
      <StartGuide
        api={api}
        settings={settings}
        running={phase === 'running'}
        active={active}
        progress={progress}
        onAction={(step) => (step === 'language' ? goToLanguages() : step === 'region' ? void run('region') : void run('start'))}
      />

      <fieldset id="session">
        <legend>Sesión</legend>
        <p id="session-status" class={`session-status phase-${phase}`} role="status" aria-live="polite">
          <span class="phase-dot" aria-hidden="true" />
          {statusSentence(phase, waitingFor, modeLabel(appState.mode, settings.mode), sourceLabel(choice))}
        </p>
        <div class="controls">
          <button type="button" id="session-start" class={controls.start ? 'primary' : ''} disabled={!controls.start} onClick={() => void run('start')}>
            Iniciar
          </button>
          <button
            type="button"
            id="session-pause"
            disabled={!controls.pause}
            onClick={() => void run(controls.pauseAction)}
          >
            {controls.pauseLabel}
          </button>
          <button type="button" id="session-restart" disabled={!controls.restart} onClick={() => void run('restart')}>
            Reiniciar
          </button>
          <button type="button" id="session-stop" class={!controls.start && controls.stop ? 'primary' : ''} disabled={!controls.stop} onClick={() => void run('stop')}>
            Detener
          </button>
        </div>
        {failure && (
          <p class="notice error" role="alert" id="session-failure">
            No se pudo completar la orden: {failure}
          </p>
        )}
        <MissingModels api={api} settings={settings} notice={notice} phase={phase} goToLanguages={goToLanguages} />
      </fieldset>

      <fieldset id="what-to-translate">
        <legend>Qué se traduce</legend>
        <RegionRow settings={settings} busy={pending !== null} onChoose={() => void run('region')} />
        <PairMenu api={api} settings={settings} catalog={catalog} running={running} active={active} progress={progress} save={save} goToLanguages={goToLanguages} />
        <ModeRow settings={settings} save={save} />
      </fieldset>

      <fieldset id="audio-source">
        <legend>Audio</legend>
        <SourcePicker api={api} settings={settings} active={active} save={save} />
        <LevelMeter api={api} levels={levels} active={active} status={meter} />
      </fieldset>
    </>
  )
}

// ------------------------------------------------------------------------- modelos que faltan

function MissingModels({
  api,
  settings,
  notice,
  phase,
  goToLanguages,
}: {
  api: SettingsApi
  settings: Settings
  notice: Notice | null
  phase: string
  goToLanguages: () => void
}) {
  const shown = notice?.code === 'models-missing' && (phase === 'idle' || phase === 'error')
  const [size, setSize] = useState<string | null>(null)
  useEffect(() => {
    if (!shown) return
    let alive = true
    api
      .modelStatus(settings.from, settings.targets, scopeForMode(settings.mode))
      .then((list) => {
        const { missing, missingBytes } = summarize(list)
        if (alive) setSize(missing.length > 0 ? formatBytes(missingBytes) : null)
      })
      .catch(() => alive && setSize(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `targets.join` resume `settings.targets`
  }, [api, shown, notice, settings.from, settings.targets.join('+'), settings.mode])
  if (!shown || !notice) return null
  return (
    <div class="notice warning" id="models-missing" role="alert">
      <p>{notice.message}</p>
      <p>
        Faltan modelos para {languagesSummary(settings)}
        {size ? ` (${size} por descargar)` : ''}.
      </p>
      <button type="button" id="go-languages" onClick={goToLanguages}>
        Ir a Idiomas
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------------- fuente

function SourcePicker({ api, settings, active, save }: { api: SettingsApi; settings: Settings; active: boolean; save: Props['save'] }) {
  const choice = audioSourceOf(settings)
  const [info, setInfo] = useState<AudioSourcesInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!active) return
    let alive = true
    let busy = false
    const refresh = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const next = await api.listAudioSources()
        if (alive) {
          setInfo(next)
          setFailed(false)
        }
      } catch {
        if (alive) setFailed(true)
      }
      busy = false
    }
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [api, active])

  const { options, note } = sourceOptions(info, choice, failed)
  return (
    <>
      <label for="source-select">
        Fuente del audio
        <select
          id="source-select"
          value={choiceToValue(choice)}
          aria-describedby={note ? 'source-note' : undefined}
          onChange={(e) => void save({ audioSource: valueToChoice((e.currentTarget as HTMLSelectElement).value) })}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p id="source-note" class={note === SOURCES_ERROR ? 'field-error' : 'hint'} hidden={!note}>
        {note}
      </p>
      <p class="hint">Con una sesión en marcha, cambiar la fuente la reinicia.</p>
    </>
  )
}

// ----------------------------------------------------------------------------------- medidor

function LevelMeter({ api, levels, active, status }: { api: SettingsApi; levels: LevelStore; active: boolean; status: MeterStatus }) {
  // Hay captura midiendo: la sesión traduciendo o la escucha previa. Si no, la barra queda a cero.
  const live = meterLive(status)
  const note = meterNote(status)
  const [threshold, setThreshold] = useState<number | null>(null)
  const [advice, setAdvice] = useState<LevelAdvice>(null)
  const fill = useRef<HTMLDivElement>(null)
  const meter = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    api
      .voiceThreshold()
      .then((v) => alive && setThreshold(v))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api])

  const paint = useCallback(
    (percent: number, above: boolean) => {
      const rounded = Math.round(percent)
      if (fill.current) {
        fill.current.style.width = `${percent.toFixed(1)}%`
        fill.current.classList.toggle('voice', above)
      }
      if (meter.current) {
        meter.current.setAttribute('aria-valuenow', String(rounded))
        meter.current.setAttribute('aria-valuetext', meterText(percent, above))
      }
    },
    [],
  )

  // Sin captura midiendo el medidor queda a cero y sin aviso; el historial no se arrastra a la captura siguiente.
  useEffect(() => {
    if (live) return
    levels.clear()
    setAdvice(null)
    paint(0, false)
  }, [live, levels, paint])

  // Animación: solo mientras la pestaña está a la vista, la ventana visible y hay una captura midiendo.
  useEffect(() => {
    if (!live || !active) return
    let frame = 0
    let last = performance.now()
    let shown = 0
    let lastAdvice: LevelAdvice = null
    const tick = (time: number) => {
      const dt = time - last
      last = time
      const target = levelToPercent(levels.latest())
      shown = smoothLevel(shown, target, dt)
      const above = threshold !== null && levels.latest() >= threshold
      paint(shown, above)
      const next = threshold === null ? null : levelAdvice(levels.history(), threshold, Date.now(), { running: true })
      if (next !== lastAdvice) {
        lastAdvice = next
        setAdvice(next)
      }
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(frame)
      last = performance.now()
      if (!document.hidden) frame = requestAnimationFrame(tick)
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', start)
    }
  }, [live, active, levels, threshold, paint])

  const mark = threshold === null ? null : levelToPercent(threshold)
  return (
    <div class="level">
      <span id="level-label" class="level-label">
        Nivel del audio
      </span>
      <div
        ref={meter}
        id="level-meter"
        class="meter"
        role="meter"
        aria-labelledby="level-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext={meterText(0, false)}
      >
        <div ref={fill} class="meter-fill" />
        {mark !== null && <div class="meter-mark" style={{ left: `${mark.toFixed(1)}%` }} title="Umbral de voz" />}
      </div>
      <p id="monitor-note" class={`hint meter-note ${status.kind}`} role="status" hidden={note === ''}>
        {note}
      </p>
      <p class="hint meter-hint">La marca indica el umbral a partir del cual el audio cuenta como voz.</p>
      <div id="level-advice" role="status" aria-live="polite">
        {advice && <p class="notice warning">{ADVICE_TEXT[advice]}</p>}
      </div>
    </div>
  )
}
