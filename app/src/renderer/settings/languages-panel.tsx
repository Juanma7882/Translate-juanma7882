// Pestaña de idiomas y subtítulos: el idioma del contenido, hasta dos subtítulos (el original y/o
// traducciones, cada uno en un idioma distinto), los modelos que hacen falta y las descargas.
// Funciona sin modelos descargados: la app arranca igual y aquí se bajan cuando se quiera.

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { AppState, SettingsApi } from '../../shared/ipc.ts'
import { scopeForMode } from '../../shared/mode.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import { changeSource, formatBytes, languageName, overallPercent, patchForSubtitles, sourceLanguages, subtitleOptions, subtitlesOf, summarize } from './form.ts'
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

/** Etiqueta de un idioma de subtítulo: el de origen es el texto original, sin traducir. */
const optionLabel = (lang: string, from: string): string => (lang === from ? `${languageName(lang)} (texto original)` : `${languageName(lang)} (traducción)`)

export function LanguagesPanel({ api, settings, catalog, appState, progress, clearProgress, save, announce }: Props) {
  const [pairStatuses, setPairStatuses] = useState<Record<string, ModelStatusInfo[]>>({})
  const [selection, setSelection] = useState<ModelStatusInfo[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removedNote, setRemovedNote] = useState('')
  const real = settings.engines === 'real'
  const scope = scopeForMode(settings.mode)
  const pairs = useMemo(() => (catalog ? [...catalog.pairs].sort((a, b) => key(a.from, a.to).localeCompare(key(b.from, b.to))) : []), [catalog])
  const targetsKey = settings.targets.join('+')

  const refresh = useCallback(async () => {
    if (!real) return
    const entries = await Promise.all(pairs.map(async (p) => [key(p.from, p.to), await api.modelStatus(p.from, [p.to], scope).catch(() => [] as ModelStatusInfo[])] as const))
    setPairStatuses(Object.fromEntries(entries))
    setSelection(await api.modelStatus(settings.from, settings.targets, scope).catch(() => [] as ModelStatusInfo[]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `targetsKey` resume `settings.targets`
  }, [api, pairs, real, scope, settings.from, targetsKey])

  useEffect(() => {
    void refresh()
  }, [refresh, progress])

  const download = async (id: string, from: string, to: string[]) => {
    clearProgress()
    setError(null)
    setDownloading(id)
    try {
      await api.downloadModels(from, to, scope)
      announce('Modelos descargados.')
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

  const choice = subtitlesOf(settings)
  const sources = catalog ? sourceLanguages(catalog, settings.mode) : []
  const sourceChoices = sources.includes(settings.from) ? sources : [settings.from, ...sources]

  const setSource = async (from: string) => {
    if (!catalog || from === settings.from) return
    const change = changeSource(catalog, settings, from)
    const saved = await save(change.patch)
    const note = saved && change.removed.length > 0 ? `Se quitó ${change.removed.map((lang) => languageName(lang)).join(' y ')} porque no hay traducción desde ${languageName(from)}.` : ''
    setRemovedNote(note)
    if (note) announce(note)
  }

  // Cada selector no ofrece el idioma del otro. Como el original va siempre arriba, si queda en el
  // subtítulo 2 la interfaz lo muestra como subtítulo 1 (ver `subtitlesOf`).
  const setFirst = (lang: string) => void save(patchForSubtitles(settings.from, { first: lang, second: choice.second }))
  const setSecond = (lang: string) => void save(patchForSubtitles(settings.from, { first: choice.first, second: lang }))
  const toggleSecond = (on: boolean) => {
    if (!on) return void save(patchForSubtitles(settings.from, { first: choice.first, second: null }))
    const options = catalog ? subtitleOptions(catalog, settings.from, choice.first) : []
    // Por defecto, el segundo subtítulo es la primera traducción disponible; si no hay, el original.
    const next = options.find((lang) => lang !== settings.from) ?? options[0]
    if (next) void save(patchForSubtitles(settings.from, { first: choice.first, second: next }))
  }

  const selectionSummary = summarize(selection)
  const selectionPercent = overallPercent(progress, selectionSummary.missing)
  const busySelection = downloading === 'selection'
  const secondOptions = catalog ? subtitleOptions(catalog, settings.from, choice.first) : []
  const canAddSecond = secondOptions.length > 0

  return (
    <fieldset id="languages">
      <legend>Idiomas y subtítulos</legend>
      <p class="hint">La aplicación funciona aunque no hayas descargado nada; los modelos solo se necesitan para leer y traducir. La descarga requiere internet una única vez.</p>
      {error && (
        <p class="notice error" role="alert">
          La descarga no se pudo completar: {error}
        </p>
      )}
      {!catalog && <p role="status">Cargando idiomas…</p>}

      <div class="field">
        <label for="source-language">El contenido está en…</label>
        <select id="source-language" value={settings.from} disabled={!catalog} onChange={(e) => void setSource((e.currentTarget as HTMLSelectElement).value)}>
          {sourceChoices.map((lang) => (
            <option key={lang} value={lang}>
              {languageName(lang)}
            </option>
          ))}
        </select>
      </div>
      {removedNote && (
        <p class="hint" id="removed-note" role="status">
          {removedNote}
        </p>
      )}

      <fieldset id="subtitles" class="subtitles">
        <legend>Subtítulos (uno o dos, en idiomas distintos)</legend>
        <div class="field">
          <label for="subtitle-1">Subtítulo 1</label>
          <select id="subtitle-1" value={choice.first} disabled={!catalog} onChange={(e) => setFirst((e.currentTarget as HTMLSelectElement).value)}>
            {(catalog ? subtitleOptions(catalog, settings.from, choice.second) : [choice.first]).map((lang) => (
              <option key={lang} value={lang}>
                {optionLabel(lang, settings.from)}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="inline">
            <input type="checkbox" id="subtitle-2-on" checked={choice.second !== null} disabled={!catalog || (choice.second === null && !canAddSecond)} onChange={(e) => toggleSecond((e.currentTarget as HTMLInputElement).checked)} />
            Mostrar un segundo subtítulo
          </label>
          {choice.second !== null && (
            <select id="subtitle-2" aria-label="Subtítulo 2" value={choice.second} onChange={(e) => setSecond((e.currentTarget as HTMLSelectElement).value)}>
              {(catalog ? subtitleOptions(catalog, settings.from, choice.first) : [choice.second]).map((lang) => (
                <option key={lang} value={lang}>
                  {optionLabel(lang, settings.from)}
                </option>
              ))}
            </select>
          )}
        </div>
        <p class="hint">Como máximo dos subtítulos a la vez. El texto original siempre se muestra arriba y la traducción debajo.</p>
        {appState.running && (
          <p class="hint" id="restart-note">
            Hay una sesión en marcha: si cambias el idioma o los subtítulos, se reiniciará con la configuración nueva.
          </p>
        )}

        <div class="selection-models" id="selection-models" role="group" aria-label="Modelos de los subtítulos elegidos">
          {selection.length === 0 ? (
            <span class="installed-size">…</span>
          ) : selectionSummary.allReady ? (
            <span class="installed-size">Modelos listos</span>
          ) : busySelection ? (
            <span>
              <progress max={100} value={selectionPercent} aria-label="Descargando los modelos de los subtítulos" /> {selectionPercent}%{' '}
              <button type="button" data-action="cancel" onClick={() => void api.cancelDownload()}>
                Cancelar
              </button>
            </span>
          ) : (
            <>
              <span class="installed-size">Faltan {formatBytes(selectionSummary.missingBytes)}</span>
              <button type="button" id="download-selection" disabled={downloading !== null} onClick={() => void download('selection', settings.from, settings.targets)}>
                Descargar
              </button>
            </>
          )}
        </div>
      </fieldset>

      <details id="all-pairs">
        <summary>Descargar más idiomas</summary>
        <ul class="installed-list">
          {pairs.map((p) => {
            const id = key(p.from, p.to)
            const list = pairStatuses[id] ?? []
            const summary = summarize(list)
            const active = settings.from === p.from && settings.targets.includes(p.to)
            const busy = downloading === id
            const percent = overallPercent(progress, summary.missing)
            return (
              <li key={id} data-pair={id}>
                <span class="installed-name">
                  {languageName(p.from)} → {languageName(p.to)} {active && <strong>(en uso)</strong>}
                </span>
                <span class="installed-size">{list.length === 0 ? '…' : summary.allReady ? 'Listo' : `Faltan ${formatBytes(summary.missingBytes)}`}</span>
                {busy ? (
                  <span>
                    <progress max={100} value={percent} aria-label={`Descargando ${languageName(p.from)} a ${languageName(p.to)}`} /> {percent}%{' '}
                    <button type="button" data-action="cancel" onClick={() => void api.cancelDownload()}>
                      Cancelar
                    </button>
                  </span>
                ) : summary.allReady ? (
                  <button
                    type="button"
                    data-action="use"
                    disabled={active && settings.targets.length === 1}
                    onClick={() => void save({ from: p.from, targets: [p.to], overlay: { showOriginal: settings.overlay.showOriginal } })}
                  >
                    {active && settings.targets.length === 1 ? 'Elegido' : 'Usar'}
                  </button>
                ) : (
                  <button type="button" data-action="download" disabled={downloading !== null || list.length === 0} onClick={() => void download(id, p.from, [p.to])}>
                    Descargar
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </details>
    </fieldset>
  )
}
