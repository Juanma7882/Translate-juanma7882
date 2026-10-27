import { render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { AppState, Notice } from '../../shared/ipc.ts'
import { ACTIVE_LABELS, MODE_LABELS, MODES } from '../../shared/mode.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import {
  applyProgress,
  checkPatch,
  FONT_CHOICES,
  formatBytes,
  languageName,
  overallPercent,
  pickPair,
  sourceLanguages,
  summarize,
  targetLanguages,
} from './form.ts'
import type { DownloadProgress } from './form.ts'

const api = window.trSettings

type Download = { phase: 'idle' } | { phase: 'running' } | { phase: 'error'; message: string }

function App({ api }: { api: NonNullable<typeof window.trSettings> }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [statuses, setStatuses] = useState<ModelStatusInfo[]>([])
  const [audioStatuses, setAudioStatuses] = useState<ModelStatusInfo[]>([])
  const [progress, setProgress] = useState<DownloadProgress>({})
  const [download, setDownload] = useState<Download>({ phase: 'idle' })
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [appState, setAppState] = useState<AppState>({ running: false, paused: false, mode: null })
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  const refreshStatus = useCallback(
    async (from: string, to: string) => {
      try {
        setStatuses(await api.modelStatus(from, to))
      } catch {
        setStatuses([])
      }
      // Los modelos de audio (voz) pueden no existir para este idioma: sin fila en ese caso.
      try {
        setAudioStatuses(await api.modelStatus(from, to, 'audio'))
      } catch {
        setAudioStatuses([])
      }
    },
    [api],
  )

  useEffect(() => {
    api.onSettingsChanged(setSettings)
    api.onModelProgress((event) => setProgress((current) => applyProgress(current, event)))
    api.onAppState(setAppState)
    api.onNotice(setNotice)
    void (async () => {
      const [current, cat] = await Promise.all([api.getSettings(), api.modelCatalog().catch(() => null)])
      setSettings(current)
      setCatalog(cat)
      await refreshStatus(current.from, current.to)
    })()
  }, [api, refreshStatus])

  // El estado de los modelos depende del par de idiomas y del motor.
  const engines = settings?.engines
  const from = settings?.from
  const to = settings?.to
  useEffect(() => {
    if (from && to && engines === 'real') void refreshStatus(from, to)
    else {
      setStatuses([])
      setAudioStatuses([])
    }
  }, [from, to, engines, refreshStatus])

  const save = useCallback(
    async (patch: SettingsPatch) => {
      const current = settingsRef.current
      if (!current) return
      const check = checkPatch(current, patch, current.engines === 'real' ? catalog : null)
      if (!check.ok) {
        setErrors(check.errors)
        return
      }
      const result = await api.updateSettings(patch)
      setErrors(result.ok ? [] : result.errors)
      if (result.ok) setSettings(result.settings)
    },
    [api, catalog],
  )

  const summary = useMemo(() => summarize(statuses), [statuses])
  const audioSummary = useMemo(() => summarize(audioStatuses), [audioStatuses])

  const startDownload = useCallback(async (scope?: 'audio' | 'all') => {
    const current = settingsRef.current
    if (!current) return
    setProgress({})
    setDownload({ phase: 'running' })
    try {
      await api.downloadModels(current.from, current.to, scope)
      setDownload({ phase: 'idle' })
    } catch (error) {
      setDownload({ phase: 'error', message: error instanceof Error ? error.message : 'No se pudieron descargar los modelos.' })
    }
    await refreshStatus(current.from, current.to)
  }, [api, refreshStatus])

  if (!settings) return <p role="status">Cargando…</p>

  const sources = catalog ? sourceLanguages(catalog) : [settings.from]
  const targets = catalog ? targetLanguages(catalog, settings.from) : [settings.to]
  const percent = overallPercent(progress, [...summary.missing, ...audioSummary.missing])
  const overlay = settings.overlay
  const busy = download.phase === 'running'

  const changeFrom = (value: string) => {
    const pair = catalog ? pickPair(catalog, value, settings.to) : { from: value, to: settings.to }
    if (pair) void save({ from: pair.from, to: pair.to })
  }

  return (
    <main>
      <h1>Ajustes</h1>

      <div id="notice" role="status" aria-live="polite">
        {notice && <p class={`notice ${notice.level}`}>{notice.message}</p>}
      </div>
      <div id="errors" role="alert">
        {errors.map((message) => (
          <p key={message} class="notice error">
            {message}
          </p>
        ))}
      </div>
      <p id="app-state" class="hint">
        {appState.running
          ? `${appState.paused ? 'Traducción en pausa' : 'Traduciendo'}${appState.mode ? ` (modo ${ACTIVE_LABELS[appState.mode].toLowerCase()})` : ''}.`
          : 'Sin traducción en curso.'}
      </p>

      <fieldset id="mode-group">
        <legend>Modo</legend>
        {MODES.map((value) => (
          <label class="inline" key={value}>
            <input type="radio" name="mode" id={`mode-${value}`} value={value} checked={settings.mode === value} onChange={() => void save({ mode: value })} />
            {MODE_LABELS[value]}
          </label>
        ))}
        <p class="hint">
          {settings.mode === 'auto' && 'Traduce el texto de la región y, si no hay texto, subtitula el audio del sistema; vuelve al texto cuando reaparece.'}
          {settings.mode === 'text' && 'Solo traduce el texto de la región elegida.'}
          {settings.mode === 'audio' && 'Solo subtitula el audio del sistema; no necesita elegir una región.'}
        </p>
        {settings.mode === 'auto' && (
          <label>
            Pasar a audio tras (segundos sin texto)
            <input
              id="fallbackSeconds"
              type="number"
              min="1"
              max="60"
              value={settings.fallbackSeconds}
              onChange={(e) => void save({ fallbackSeconds: Number(e.currentTarget.value) })}
            />
          </label>
        )}
        {settings.engines === 'real' && settings.mode !== 'text' && audioStatuses.length > 0 && !audioSummary.allReady && (
          <p id="audio-required" class="notice warning">
            Este modo necesita los modelos de audio ({formatBytes(audioSummary.missingBytes)} por descargar); se descargan abajo, en Modelos.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Idiomas</legend>
        <label>
          Traducir desde
          <select id="from" value={settings.from} onChange={(e) => changeFrom(e.currentTarget.value)}>
            {sources.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Traducir a
          <select id="to" value={settings.to} onChange={(e) => void save({ to: e.currentTarget.value })}>
            {targets.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Motor</legend>
        <label class="inline">
          <input type="radio" name="engines" value="real" checked={settings.engines === 'real'} onChange={() => void save({ engines: 'real' })} />
          Local (OCR y traducción en este equipo)
        </label>
        <label class="inline">
          <input type="radio" name="engines" value="fake" checked={settings.engines === 'fake'} onChange={() => void save({ engines: 'fake' })} />
          Demostración (sin modelos)
        </label>
      </fieldset>

      {settings.engines === 'real' && (
        <fieldset id="models">
          <legend>Modelos</legend>
          <ul>
            {statuses.map((model) => (
              <li key={model.id} data-state={model.state}>
                {model.id} · {formatBytes(model.size)} · {model.state === 'ready' ? 'listo' : model.state === 'downloading' ? 'descargando' : 'falta'}
              </li>
            ))}
          </ul>
          {summary.allReady && <p id="models-ready">Los modelos están listos: funciona sin conexión.</p>}
          {!summary.allReady && statuses.length > 0 && !busy && (
            <p>
              Faltan {formatBytes(summary.missingBytes)} por descargar. Se necesita conexión a internet solo para esta descarga.
            </p>
          )}
          {busy && (
            <div>
              <progress id="download-progress" max={100} value={percent} aria-label="Progreso de la descarga de modelos" />
              <span aria-hidden="true"> {percent}%</span>
            </div>
          )}
          {download.phase === 'error' && (
            <p class="notice error" role="alert">
              {download.message}
            </p>
          )}
          {!summary.allReady && statuses.length > 0 && (
            <button type="button" id="download" disabled={busy} onClick={() => void startDownload(settings.mode === 'auto' && audioStatuses.length > 0 ? 'all' : undefined)}>
              {download.phase === 'error' ? 'Reintentar descarga' : 'Descargar modelos'}
            </button>
          )}
          {audioStatuses.length > 0 && (
            <div id="audio-models">
              <h2>Subtítulos del audio</h2>
              <ul>
                {audioStatuses.map((model) => (
                  <li key={model.id} data-state={model.state}>
                    {model.id} · {formatBytes(model.size)} · {model.state === 'ready' ? 'listo' : model.state === 'downloading' ? 'descargando' : 'falta'}
                  </li>
                ))}
              </ul>
              {audioSummary.allReady ? (
                <p id="audio-models-ready">Los modelos de audio están listos.</p>
              ) : (
                <button type="button" id="download-audio" disabled={busy} onClick={() => void startDownload('audio')}>
                  Descargar modelos de audio ({formatBytes(audioSummary.missingBytes)})
                </button>
              )}
            </div>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Apariencia del texto</legend>
        <label>
          Opacidad
          <input
            id="opacity"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={overlay.opacity}
            onChange={(e) => void save({ overlay: { opacity: Number(e.currentTarget.value) } })}
          />
        </label>
        <label>
          Tamaño de fuente (px)
          <input id="fontSize" type="number" min="10" max="96" value={overlay.fontSize} onChange={(e) => void save({ overlay: { fontSize: Number(e.currentTarget.value) } })} />
        </label>
        <label>
          Fuente
          <select id="fontFamily" value={overlay.fontFamily} onChange={(e) => void save({ overlay: { fontFamily: e.currentTarget.value } })}>
            {FONT_CHOICES.some((f) => f.value === overlay.fontFamily) ? null : <option value={overlay.fontFamily}>Personalizada</option>}
            {FONT_CHOICES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ancho (px)
          <input id="width" type="number" min="200" max="3000" value={overlay.width} onChange={(e) => void save({ overlay: { width: Number(e.currentTarget.value) } })} />
        </label>
        <label>
          Ocultar tras (segundos, 0 = no ocultar)
          <input
            id="hideAfter"
            type="number"
            min="0"
            max="600"
            value={Math.round(overlay.hideAfterMs / 1000)}
            onChange={(e) => void save({ overlay: { hideAfterMs: Math.round(Number(e.currentTarget.value) * 1000) } })}
          />
        </label>
        <label class="inline">
          <input id="showOriginal" type="checkbox" checked={overlay.showOriginal} onChange={(e) => void save({ overlay: { showOriginal: e.currentTarget.checked } })} />
          Mostrar también el texto original
        </label>
        <div id="preview" aria-label="Vista previa" style={{ opacity: overlay.opacity, fontSize: `${overlay.fontSize}px`, fontFamily: overlay.fontFamily }}>
          {overlay.showOriginal && <div class="original">Hello, world</div>}
          <div class="translated">Hola, mundo</div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Atajos de teclado</legend>
        <label>
          Elegir región
          <input id="shortcut-select" type="text" value={settings.shortcuts.selectRegion} onChange={(e) => void save({ shortcuts: { selectRegion: e.currentTarget.value } })} />
        </label>
        <label>
          Pausar o reanudar
          <input id="shortcut-pause" type="text" value={settings.shortcuts.togglePause} onChange={(e) => void save({ shortcuts: { togglePause: e.currentTarget.value } })} />
        </label>
        <label>
          Cambiar de modo
          <input id="shortcut-mode" type="text" value={settings.shortcuts.toggleMode} onChange={(e) => void save({ shortcuts: { toggleMode: e.currentTarget.value } })} />
        </label>
      </fieldset>
    </main>
  )
}

const root = document.getElementById('app')
if (root) render(api ? <App api={api} /> : <p role="alert">No se pudo conectar con la aplicación.</p>, root)
