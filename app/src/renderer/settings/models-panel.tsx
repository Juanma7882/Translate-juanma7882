// Pestaña de modelos: los del par elegido (descargar, cancelar, reanudar), los instalados con su
// espacio y borrado, y la carpeta donde viven.

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { ModelInventory, ModelStatusInfo } from 'tr-bindings'

import type { AppState, SettingsApi } from '../../shared/ipc.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import { deleteMessage, formatBytes, installedRows, overallPercent, partialBytesOf, stateLabel, summarize } from './form.ts'
import type { DownloadProgress, Issue } from './form.ts'
import { FieldError, fieldProps } from './ui.tsx'

type Download = { phase: 'idle' } | { phase: 'running' } | { phase: 'cancelled' } | { phase: 'error'; message: string }

interface Props {
  api: SettingsApi
  settings: Settings
  appState: AppState
  progress: DownloadProgress
  clearProgress: () => void
  issues: readonly Issue[]
  save: (patch: SettingsPatch) => Promise<boolean>
  announce: (message: string) => void
}

function ModelList({ statuses }: { statuses: readonly ModelStatusInfo[] }) {
  return (
    <ul>
      {statuses.map((model) => (
        <li key={model.id} data-state={model.state}>
          {model.id} · {formatBytes(model.size)} · {stateLabel(model.state)}
        </li>
      ))}
    </ul>
  )
}

export function ModelsPanel({ api, settings, appState, progress, clearProgress, issues, save, announce }: Props) {
  const [statuses, setStatuses] = useState<ModelStatusInfo[]>([])
  const [audioStatuses, setAudioStatuses] = useState<ModelStatusInfo[]>([])
  const [inventory, setInventory] = useState<ModelInventory | null>(null)
  const [download, setDownload] = useState<Download>({ phase: 'idle' })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [dirDraft, setDirDraft] = useState<string | null>(null)

  const { from, to, engines, modelsDir } = settings
  const real = engines === 'real'

  const refresh = useCallback(async () => {
    try {
      setInventory(await api.modelInventory())
    } catch {
      setInventory(null)
    }
    if (!real) {
      setStatuses([])
      setAudioStatuses([])
      return
    }
    try {
      setStatuses(await api.modelStatus(from, to))
    } catch {
      setStatuses([])
    }
    // Los modelos de audio pueden no existir para este idioma: sin fila en ese caso.
    try {
      setAudioStatuses(await api.modelStatus(from, to, 'audio'))
    } catch {
      setAudioStatuses([])
    }
  }, [api, from, to, real, modelsDir])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Al terminar una sesión (o empezar) cambian los bloqueos, no los datos: solo se refresca al parar.
  useEffect(() => {
    if (!appState.running) void refresh()
  }, [appState.running, refresh])

  const summary = useMemo(() => summarize(statuses), [statuses])
  const audioSummary = useMemo(() => summarize(audioStatuses), [audioStatuses])
  const neededIds = [...statuses, ...audioStatuses].map((s) => s.id)
  const partial = partialBytesOf(inventory, neededIds)
  const busy = download.phase === 'running'
  const percent = overallPercent(progress, [...summary.missing, ...audioSummary.missing])

  const startDownload = async (scope?: 'audio' | 'all') => {
    clearProgress()
    setDownload({ phase: 'running' })
    try {
      await api.downloadModels(from, to, scope)
      setDownload({ phase: 'idle' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('cancelled')) {
        setDownload({ phase: 'cancelled' })
        announce('Descarga cancelada. Lo descargado se conserva para reanudar.')
      } else {
        setDownload({ phase: 'error', message })
      }
    }
    await refresh()
  }

  const remove = async (id: string) => {
    setConfirming(null)
    const result = await api.deleteModel(id)
    if (result.ok) announce(`Modelo borrado. Se liberaron ${formatBytes(result.freed)}.`)
    else announce(deleteMessage(result.reason))
    await refresh()
    document.getElementById('installed')?.focus()
  }

  const commitDir = async (value: string | null) => {
    const saved = await save({ modelsDir: value })
    if (saved) {
      setDirDraft(null)
      announce(value === null ? 'Se usará la carpeta de modelos predeterminada.' : 'Carpeta de modelos guardada. Se usará desde la próxima traducción.')
    }
    await refresh()
  }

  const pickDir = async () => {
    const picked = await api.pickModelsDir()
    if (picked) {
      setDirDraft(picked)
      await commitDir(picked)
    }
  }

  const rows = inventory ? installedRows(inventory) : []
  const effectiveDir = inventory?.dir ?? ''
  const downloadLabel = download.phase === 'error' && partial === 0 ? 'Reintentar descarga' : partial > 0 ? 'Reanudar descarga' : 'Descargar modelos'

  return (
    <>
      {real && (
        <fieldset id="models">
          <legend>Modelos del par elegido</legend>
          <ModelList statuses={statuses} />
          {summary.allReady && <p id="models-ready">Los modelos están listos: funciona sin conexión.</p>}
          {!summary.allReady && statuses.length > 0 && !busy && (
            <p>
              Faltan {formatBytes(summary.missingBytes)} por descargar. Se necesita conexión a internet solo para esta descarga.
              {partial > 0 && ` Hay ${formatBytes(partial)} ya descargados que se reanudarán.`}
            </p>
          )}
          {busy && (
            <div>
              <progress id="download-progress" max={100} value={percent} aria-label="Progreso de la descarga de modelos" />
              <span aria-hidden="true"> {percent}%</span>{' '}
              <button type="button" id="cancel-download" onClick={() => void api.cancelDownload()}>
                Cancelar descarga
              </button>
            </div>
          )}
          {download.phase === 'cancelled' && (
            <p id="download-cancelled" class="notice warning">
              Descarga cancelada. Lo descargado se conserva y continuará donde quedó.
            </p>
          )}
          {download.phase === 'error' && (
            <p class="notice error" role="alert">
              La descarga no se pudo completar: {download.message}
            </p>
          )}
          {!summary.allReady && statuses.length > 0 && (
            <button type="button" id="download" disabled={busy} onClick={() => void startDownload(settings.mode === 'auto' && audioStatuses.length > 0 ? 'all' : undefined)}>
              {downloadLabel}
            </button>
          )}
          {audioStatuses.length > 0 && (
            <div id="audio-models">
              <h2>Subtítulos del audio</h2>
              <ModelList statuses={audioStatuses} />
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

      <fieldset id="installed" tabIndex={-1}>
        <legend>Modelos instalados</legend>
        {rows.length === 0 ? (
          <p id="installed-empty">No hay modelos descargados.</p>
        ) : (
          <ul class="installed-list">
            {rows.map((row) => (
              <li key={row.id} data-model={row.id}>
                <span class="installed-name">
                  {row.title} <span class="muted">({row.id})</span>
                </span>
                <span class="installed-size">
                  {formatBytes(row.bytes)}
                  {row.partialBytes > 0 && row.state !== 'ready' ? ' · descarga a medias' : ''}
                </span>
                {confirming === row.id ? (
                  <span role="group" aria-label={`Confirmar borrado de ${row.title}`}>
                    <button type="button" class="danger" data-action="confirm-delete" onClick={() => void remove(row.id)}>
                      Sí, borrar
                    </button>{' '}
                    <button type="button" data-action="cancel-delete" onClick={() => setConfirming(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-action="delete"
                    aria-label={`Borrar ${row.title}`}
                    disabled={appState.running || busy}
                    aria-describedby={appState.running ? 'delete-blocked' : undefined}
                    onClick={() => setConfirming(row.id)}
                  >
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p id="installed-total">Espacio ocupado: {formatBytes(inventory?.totalBytes ?? 0)}</p>
        {appState.running && (
          <p id="delete-blocked" class="hint">
            Hay una traducción en marcha: no se pueden borrar modelos hasta detenerla.
          </p>
        )}
      </fieldset>

      <fieldset id="models-folder">
        <legend>Carpeta de modelos</legend>
        <label for="models-dir">Carpeta</label>
        <div class="row">
          <input
            {...fieldProps('models-dir', issues, 'hint')}
            type="text"
            value={dirDraft ?? modelsDir ?? ''}
            placeholder={modelsDir === null ? effectiveDir || 'Predeterminada' : ''}
            disabled={appState.running}
            onInput={(e) => setDirDraft(e.currentTarget.value)}
            onChange={(e) => void commitDir(e.currentTarget.value.trim() === '' ? null : e.currentTarget.value.trim())}
          />
          <button type="button" id="pick-dir" disabled={appState.running} onClick={() => void pickDir()}>
            Examinar…
          </button>
          <button type="button" id="reset-dir" disabled={appState.running || modelsDir === null} onClick={() => void commitDir(null)}>
            Predeterminada
          </button>
        </div>
        <FieldError id="models-dir" issues={issues} />
        <p id="models-dir-hint" class="hint">
          Carpeta en uso: <span id="effective-dir">{effectiveDir || '…'}</span>. Al cambiarla, los modelos ya descargados no se mueven ni se borran: seguirán en la carpeta anterior y se descargarán de nuevo en la nueva cuando se necesiten.
        </p>
      </fieldset>
    </>
  )
}
