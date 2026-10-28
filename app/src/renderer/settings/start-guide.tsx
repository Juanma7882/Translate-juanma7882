// Guía de primer uso en la pestaña Inicio: tres pasos que se tachan solos según el estado real y que
// desaparecen para siempre al completarse. La lógica vive en `home.ts`; aquí solo se consulta y se pinta.

import { useEffect, useRef, useState } from 'preact/hooks'

import type { SettingsApi } from '../../shared/ipc.ts'
import { scopeForMode } from '../../shared/mode.ts'
import type { Settings } from '../../shared/settings.ts'
import { summarize } from './form.ts'
import type { DownloadProgress } from './form.ts'
import { firstRunSteps, GUIDE_DONE_KEY, GUIDE_STARTED_KEY, readFlag, writeFlag } from './home.ts'
import type { FlagStore, GuideStepId } from './home.ts'

/** `localStorage` puede faltar o lanzar (ventana privada, datos bloqueados): se trata como «sin memoria». */
function browserStore(): FlagStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

interface Props {
  api: SettingsApi
  settings: Settings
  /** ¿Hay una sesión traduciendo ahora? Cuenta como «ya se inició alguna vez». */
  running: boolean
  /** ¿Está la pestaña a la vista? Al volver a ella se reconsultan los modelos (se pudieron borrar o bajar en otra). */
  active: boolean
  progress: DownloadProgress
  onAction: (step: GuideStepId) => void
}

const ACTION_LABELS: Record<GuideStepId, string> = {
  language: 'Ir a Idiomas',
  region: 'Elegir región',
  start: 'Iniciar',
}

export function StartGuide({ api, settings, running, active, progress, onAction }: Props) {
  const store = useRef(browserStore()).current
  const [finished, setFinished] = useState(() => readFlag(store, GUIDE_DONE_KEY))
  const [started, setStarted] = useState(() => readFlag(store, GUIDE_STARTED_KEY))
  const [modelsReady, setModelsReady] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const previous = useRef<Record<string, boolean> | null>(null)

  // Los motores de demostración no necesitan modelos; con los reales se pregunta por el par activo y el ámbito del modo.
  useEffect(() => {
    if (finished || !active) return
    if (settings.engines !== 'real') {
      setModelsReady(true)
      return
    }
    let alive = true
    api
      .modelStatus(settings.from, settings.targets, scopeForMode(settings.mode))
      .then((list) => alive && setModelsReady(summarize(list).allReady))
      .catch(() => alive && setModelsReady(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `targetsKey` resume `settings.targets`
  }, [api, finished, active, settings.engines, settings.from, settings.targets.join('+'), settings.mode, progress])

  useEffect(() => {
    if (!running || started) return
    writeFlag(store, GUIDE_STARTED_KEY)
    setStarted(true)
  }, [running, started, store])

  const run = firstRunSteps({ mode: settings.mode, hasRegion: settings.lastRegion !== null, modelsReady: modelsReady === true, hasEverStarted: started })

  // Anuncia el paso que acaba de cumplirse (no el estado inicial) y recuerda que la guía terminó.
  useEffect(() => {
    if (finished || modelsReady === null) return
    const now = Object.fromEntries(run.steps.map((s) => [s.id, s.done]))
    const before = previous.current
    previous.current = now
    if (before) {
      const completed = run.steps.find((s) => s.done && before[s.id] === false)
      if (completed) {
        const next = run.steps.find((s) => !s.done)
        setMessage(`Paso completado: ${completed.label}.${next ? ` Sigue: ${next.label}.` : ' Ya está todo listo.'}`)
      }
    }
    if (run.complete) {
      writeFlag(store, GUIDE_DONE_KEY)
      setFinished(true)
    }
  }, [finished, modelsReady, run.complete, run.steps.map((s) => s.done).join(), store])

  return (
    <>
      <div id="guide-live" role="status" aria-live="polite" class="sr-only">
        {message}
      </div>
      {!finished && modelsReady !== null && (
        <section id="first-run" class="guide" aria-labelledby="guide-title">
          <h2 id="guide-title">Para empezar</h2>
          <ol class="guide-steps">
            {run.steps.map((step) => (
              <li key={step.id} class={`guide-step${step.done ? ' done' : ''}${run.current === step.id ? ' current' : ''}`} data-step={step.id}>
                <span class="guide-state">{step.done ? 'Hecho:' : run.current === step.id ? 'Ahora:' : 'Pendiente:'}</span> {step.label}
                {run.current === step.id && (
                  <button type="button" class="primary guide-action" onClick={() => onAction(step.id)}>
                    {ACTION_LABELS[step.id]}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}
