// Qué se va a traducir, a un vistazo y sin salir de Inicio: región, par de idiomas instalado y modo.
// Gestionar y descargar idiomas sigue siendo cosa de la pestaña Idiomas; aquí solo se cambia entre los ya instalados.

import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ModelCatalog, ModelStatusInfo } from 'tr-bindings'

import type { SettingsApi } from '../../shared/ipc.ts'
import { MODE_LABELS, MODES, scopeForMode } from '../../shared/mode.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import { languageName, languagesSummary } from './form.ts'
import type { DownloadProgress } from './form.ts'
import { installedPairs, modeSentence, pairKey, regionSummary } from './home.ts'

// ------------------------------------------------------------------------------------ región

export function RegionRow({ settings, busy, onChoose }: { settings: Settings; busy: boolean; onChoose: () => void }) {
  const summary = regionSummary(settings.lastRegion, settings.mode)
  return (
    <div id="region-row" class="setup-row">
      <span class="setup-label" id="region-label">
        Región
      </span>
      <span class="setup-value" id="region-text" aria-labelledby="region-label">
        {summary.text}
      </span>
      {summary.canChange && (
        <button type="button" id="choose-region" disabled={busy} onClick={onChoose}>
          {summary.buttonLabel}
        </button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------------- idiomas

interface PairProps {
  api: SettingsApi
  settings: Settings
  catalog: ModelCatalog | null
  running: boolean
  active: boolean
  progress: DownloadProgress
  save: (patch: SettingsPatch) => Promise<boolean>
  goToLanguages: () => void
}

export function PairMenu({ api, settings, catalog, running, active, progress, save, goToLanguages }: PairProps) {
  const [statuses, setStatuses] = useState<Record<string, ModelStatusInfo[]>>({})
  const real = settings.engines === 'real'
  const scope = scopeForMode(settings.mode)
  const pairs = catalog?.pairs

  // Se cargan una vez al ver la pestaña y de nuevo al terminar una descarga o volver tras borrar modelos.
  useEffect(() => {
    if (!real || !active || !pairs) return
    let alive = true
    void Promise.all(pairs.map(async (p) => [pairKey(p.from, p.to), await api.modelStatus(p.from, [p.to], scope).catch(() => [] as ModelStatusInfo[])] as const)).then((entries) => {
      if (alive) setStatuses(Object.fromEntries(entries))
    })
    return () => {
      alive = false
    }
  }, [api, real, active, pairs, scope, progress])

  const installed = useMemo(() => installedPairs(catalog, statuses), [catalog, statuses])
  // Un solo destino es un par de la lista; con varios (o ninguno) la elección se hizo en Idiomas y no es un par.
  const single = settings.targets.length === 1 ? settings.targets[0] : undefined
  const custom = single === undefined
  const current = custom ? 'custom' : pairKey(settings.from, single)
  const currentInstalled = custom || installed.some((p) => pairKey(p.from, p.to) === current)
  const label = (from: string, to: string) => `${languageName(from)} → ${languageName(to)}`

  if (!real) {
    return (
      <div id="pair-row" class="setup-row">
        <span class="setup-label">Idiomas</span>
        <span class="setup-value">{languagesSummary(settings)} (motores de demostración)</span>
      </div>
    )
  }

  return (
    <div id="pair-row" class="setup-row setup-wrap">
      <label for="pair-select" class="setup-label">
        Idiomas
      </label>
      <select
        id="pair-select"
        disabled={running}
        aria-describedby={running ? 'pair-note' : undefined}
        value={current}
        onChange={(e) => {
          const [from, to] = (e.currentTarget as HTMLSelectElement).value.split('>')
          // Elegir un par fija el origen y un único destino; el subtítulo original sigue como estaba.
          if (from && to) void save({ from, targets: [to], overlay: { showOriginal: settings.overlay.showOriginal } })
        }}
      >
        {custom && <option value="custom">{languagesSummary(settings)} (elegido en Idiomas)</option>}
        {!currentInstalled && single !== undefined && <option value={current}>{label(settings.from, single)} (sin instalar)</option>}
        {installed.map((p) => (
          <option key={pairKey(p.from, p.to)} value={pairKey(p.from, p.to)}>
            {label(p.from, p.to)}
          </option>
        ))}
      </select>
      <button type="button" id="more-languages" onClick={goToLanguages}>
        {currentInstalled ? 'Descargar más idiomas' : 'Descargar este idioma'}
      </button>
      {running && (
        <p id="pair-note" class="hint setup-note">
          Detén la sesión para cambiar de idioma.
        </p>
      )}
      {!currentInstalled && !running && (
        <p id="pair-note" class="hint setup-note">
          Faltan modelos para este par: descárgalos en la pestaña Idiomas.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------- modo

export function ModeRow({ settings, save }: { settings: Settings; save: (patch: SettingsPatch) => Promise<boolean> }) {
  return (
    <div id="mode-row" class="setup-row setup-wrap">
      <span class="setup-label" id="home-mode-label">
        Modo
      </span>
      <div role="radiogroup" aria-labelledby="home-mode-label" class="setup-modes">
        {MODES.map((value) => (
          <label class="inline" key={value}>
            <input type="radio" name="home-mode" value={value} checked={settings.mode === value} onChange={() => void save({ mode: value })} />
            {MODE_LABELS[value]}
          </label>
        ))}
      </div>
      <p id="mode-sentence" class="hint setup-note">
        {modeSentence(settings.mode)}
      </p>
    </div>
  )
}
