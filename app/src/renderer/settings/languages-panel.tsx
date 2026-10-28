// Pestaña de idiomas: todos los pares disponibles con su estado, descarga con progreso y elección
// del par activo. Funciona sin modelos descargados: la app arranca igual y aquí se bajan cuando se quiera.

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { AppState, SettingsApi } from '../../shared/ipc.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import { formatBytes, languageName, overallPercent, summarize } from './form.ts'
import type { DownloadProgress } from './form.ts'

interface Props {
  api: SettingsApi
  settings: Settings
  catalog: ModelCatalog | null
  appState: AppState
  progress: DownloadProgress
  clearProgress: () => void
  save: (patch: SettingsPatch) => Promise<boolean>
  announce: (message: string) => void
}

const key = (from: string, to: string): string => `${from}>${to}`

export function LanguagesPanel({ api, settings, catalog, appState, progress, clearProgress, save, announce }: Props) {
  const [statuses, setStatuses] = useState<Record<string, ModelStatusInfo[]>>({})
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const real = settings.engines === 'real'
  const pairs = useMemo(() => (catalog ? [...catalog.pairs].sort((a, b) => key(a.from, a.to).localeCompare(key(b.from, b.to))) : []), [catalog])

  const refresh = useCallback(async () => {
    if (!real) return
    const entries = await Promise.all(
      pairs.map(async (p) => [key(p.from, p.to), await api.modelStatus(p.from, p.to).catch(() => [] as ModelStatusInfo[])] as const),
    )
    setStatuses(Object.fromEntries(entries))
  }, [api, pairs, real])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const download = async (from: string, to: string) => {
    clearProgress()
    setError(null)
    setDownloading(key(from, to))
    try {
      await api.downloadModels(from, to)
      announce(`Modelos de ${languageName(from)} a ${languageName(to)} descargados.`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('cancelled')) announce('Descarga cancelada. Lo descargado se conserva para reanudar.')
      else setError(message)
    }
    setDownloading(null)
    await refresh()
  }

  if (!real) {
    return (
      <fieldset id="languages">
        <legend>Idiomas</legend>
        <p>Estás en el modo de demostración, que no necesita modelos. Para traducir de verdad y descargar idiomas, usa el motor local.</p>
        <button type="button" id="use-real" onClick={() => void save({ engines: 'real' })}>
          Usar el motor local
        </button>
      </fieldset>
    )
  }

  return (
    <fieldset id="languages">
      <legend>Idiomas disponibles</legend>
      <p class="hint">La aplicación funciona aunque no hayas descargado nada; los modelos solo se necesitan para traducir. La descarga requiere internet una única vez.</p>
      {error && (
        <p class="notice error" role="alert">
          La descarga no se pudo completar: {error}
        </p>
      )}
      {!catalog && <p role="status">Cargando idiomas…</p>}
      <ul class="installed-list">
        {pairs.map((p) => {
          const id = key(p.from, p.to)
          const list = statuses[id] ?? []
          const summary = summarize(list)
          const active = settings.from === p.from && settings.to === p.to
          const busy = downloading === id
          const percent = overallPercent(progress, summary.missing)
          return (
            <li key={id} data-pair={id}>
              <span class="installed-name">
                {languageName(p.from)} → {languageName(p.to)} {active && <strong>(en uso)</strong>}
              </span>
              <span class="installed-size">
                {list.length === 0 ? '…' : summary.allReady ? 'Listo' : `Faltan ${formatBytes(summary.missingBytes)}`}
              </span>
              {busy ? (
                <span>
                  <progress max={100} value={percent} aria-label={`Descargando ${languageName(p.from)} a ${languageName(p.to)}`} /> {percent}%{' '}
                  <button type="button" data-action="cancel" onClick={() => void api.cancelDownload()}>
                    Cancelar
                  </button>
                </span>
              ) : summary.allReady ? (
                <button type="button" data-action="use" disabled={active || appState.running} onClick={() => void save({ from: p.from, to: p.to })}>
                  {active ? 'Elegido' : 'Usar'}
                </button>
              ) : (
                <button type="button" data-action="download" disabled={downloading !== null || list.length === 0} onClick={() => void download(p.from, p.to)}>
                  Descargar
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
