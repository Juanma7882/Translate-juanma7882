import { render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ModelCatalog } from 'tr-bindings'

import { parseHex } from '../../shared/contrast.ts'
import type { AppState, Notice, SettingsApi } from '../../shared/ipc.ts'
import { ACTIVE_LABELS, MODE_LABELS, MODES } from '../../shared/mode.ts'
import { applyPatch } from '../../shared/settings.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import {
  applyProgress,
  contrastInfo,
  FONT_CHOICES,
  languageError,
  toIssues,
} from './form.ts'
import type { DownloadProgress, Issue, TabSpec } from './form.ts'
import { HomePanel } from './home-panel.tsx'
import { createLevelStore } from './home.ts'
import { LanguagesPanel } from './languages-panel.tsx'
import { ModelsPanel } from './models-panel.tsx'
import { PreviewLines } from './preview.tsx'
import { FieldError, fieldProps, TabPanel, Tabs } from './ui.tsx'

const api = window.trSettings

const TABS: readonly TabSpec[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'languages', label: 'Idiomas' },
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Modelos' },
  { id: 'appearance', label: 'Apariencia' },
  { id: 'shortcuts', label: 'Atajos' },
  { id: 'advanced', label: 'Avanzado' },
]


function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseHex(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function App({ api }: { api: SettingsApi }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [progress, setProgress] = useState<DownloadProgress>({})
  const [issues, setIssues] = useState<Issue[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [status, setStatus] = useState('')
  const [appState, setAppState] = useState<AppState>({ running: false, paused: false, mode: null, phase: 'idle' })
  const [tab, setTab] = useState('home')
  const [moving, setMoving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draftColors, setDraftColors] = useState<{ text: string; bg: string } | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings
  const levels = useMemo(() => createLevelStore(), [])

  useEffect(() => {
    api.onSettingsChanged(setSettings)
    api.onModelProgress((event) => setProgress((current) => applyProgress(current, event)))
    api.onAppState(setAppState)
    void api.getAppState().then(setAppState, () => undefined)
    api.onNotice(setNotice)
    api.onMoveState(setMoving)
    api.onAudioLevel((level) => levels.push(level))
    void (async () => {
      const [current, cat] = await Promise.all([api.getSettings(), api.modelCatalog().catch(() => null)])
      setSettings(current)
      setCatalog(cat)
    })()
  }, [api, levels])

  /** Valida en la ventana (mismas reglas que main) y guarda; los errores salen junto al campo. */
  const save = useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      const current = settingsRef.current
      if (!current) return false
      const check = applyPatch(current, patch)
      if (!check.ok) {
        setIssues(toIssues(check.errors))
        return false
      }
      const problem = current.engines === 'real' && catalog ? languageError(catalog, check.settings.from, check.settings.targets) : null
      if (problem) {
        setIssues([{ field: null, message: problem }])
        return false
      }
      const result = await api.updateSettings(patch)
      if (!result.ok) {
        setIssues(toIssues(result.errors))
        return false
      }
      setIssues([])
      setSettings(result.settings)
      return true
    },
    [api, catalog],
  )

  const announce = useCallback((message: string) => setStatus(message), [])

  if (!settings) return <p role="status">Cargando…</p>

  const overlay = settings.overlay
  const perf = settings.performance
  const colors = draftColors ?? { text: overlay.textColor, bg: overlay.backgroundColor }
  const contrast = contrastInfo(colors.text, colors.bg)
  const fieldIssues = issues.filter((i) => i.field !== null)

  const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value)
  // Siempre se valida el par completo (texto y fondo); si no cumple, se muestra el motivo y el borrador.
  const changeColor = async (patch: { text?: string; bg?: string }) => {
    const next = { text: patch.text ?? colors.text, bg: patch.bg ?? colors.bg }
    setDraftColors(next)
    if (await save({ overlay: { textColor: next.text, backgroundColor: next.bg } })) setDraftColors(null)
  }

  const reset = async () => {
    setConfirmReset(false)
    const result = await api.resetSettings()
    setIssues([])
    setDraftColors(null)
    if (result.ok) {
      setSettings(result.settings)
      announce('Preferencias restablecidas. La región y la carpeta de modelos no cambian.')
    } else announce('No se pudieron restablecer las preferencias.')
  }
  const exportPrefs = async () => {
    const result = await api.exportSettings()
    if (result.ok) announce('Preferencias exportadas. El archivo no incluye la región ni carpetas.')
    else if (!result.canceled) setIssues(toIssues(result.errors ?? ['export failed']))
  }
  const importPrefs = async () => {
    const result = await api.importSettings()
    if (result.ok) {
      setIssues([])
      if (result.settings) setSettings(result.settings)
      announce('Preferencias importadas.')
    } else if (!result.canceled) {
      setIssues(toIssues(result.errors ?? ['import could not be read']))
      announce('No se importó nada: el archivo tiene valores no válidos.')
    }
  }
  const toggleMove = async () => setMoving(await api.moveOverlay(!moving))

  return (
    <main>
      <h1>Ajustes</h1>

      <div id="notice" role="status" aria-live="polite">
        {notice && <p class={`notice ${notice.level}`}>{notice.message}</p>}
      </div>
      <div id="errors" role="alert">
        {issues.map((issue) => (
          <p key={issue.message} class="notice error">
            {issue.message}
          </p>
        ))}
      </div>
      <div id="status" role="status" aria-live="polite" class="status">
        {status}
      </div>
      <p id="app-state" class="hint">
        {appState.running
          ? `${appState.paused ? 'Traducción en pausa' : 'Traduciendo'}${appState.mode ? ` (modo ${ACTIVE_LABELS[appState.mode].toLowerCase()})` : ''}.`
          : 'Sin traducción en curso.'}
      </p>

      <Tabs tabs={TABS} active={tab} onChange={setTab}>
        <TabPanel id="home" active={tab}>
          <HomePanel
            api={api}
            settings={settings}
            appState={appState}
            notice={notice}
            levels={levels}
            catalog={catalog}
            progress={progress}
            active={tab === 'home'}
            save={save}
            goToLanguages={() => setTab('languages')}
          />
        </TabPanel>

        <TabPanel id="languages" active={tab}>
          <LanguagesPanel
            api={api}
            settings={settings}
            catalog={catalog}
            appState={appState}
            progress={progress}
            clearProgress={() => setProgress({})}
            save={save}
            announce={announce}
          />
        </TabPanel>

        <TabPanel id="general" active={tab}>
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
              <label for="fallbackSeconds">
                Pasar a audio tras (segundos sin texto)
                <input
                  {...fieldProps('fallbackSeconds', fieldIssues)}
                  type="number"
                  min="1"
                  max="60"
                  value={settings.fallbackSeconds}
                  onChange={(e) => void save({ fallbackSeconds: num(e) })}
                />
                <FieldError id="fallbackSeconds" issues={fieldIssues} />
              </label>
            )}
          </fieldset>

        </TabPanel>

        <TabPanel id="models" active={tab}>
          <ModelsPanel
            api={api}
            settings={settings}
            appState={appState}
            progress={progress}
            clearProgress={() => setProgress({})}
            issues={fieldIssues}
            save={save}
            announce={announce}
          />
        </TabPanel>

        <TabPanel id="appearance" active={tab}>
          <div class="preview-sticky">
            <div
              id="preview"
              role="img"
              aria-label="Vista previa del overlay"
              style={{ fontSize: `${overlay.fontSize}px`, fontFamily: overlay.fontFamily, color: overlay.textColor, background: rgba(overlay.backgroundColor, overlay.opacity) }}
            >
              <PreviewLines settings={settings} />
            </div>
          </div>

          <fieldset>
            <legend>Texto del overlay</legend>
            <label for="opacity">
              Opacidad del fondo
              <input
                {...fieldProps('opacity', fieldIssues)}
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={overlay.opacity}
                onChange={(e) => void save({ overlay: { opacity: num(e) } })}
              />
              <FieldError id="opacity" issues={fieldIssues} />
            </label>
            <label for="fontSize">
              Tamaño de fuente (px)
              <input {...fieldProps('fontSize', fieldIssues)} type="number" min="10" max="96" value={overlay.fontSize} onChange={(e) => void save({ overlay: { fontSize: num(e) } })} />
              <FieldError id="fontSize" issues={fieldIssues} />
            </label>
            <label for="fontFamily">
              Fuente
              <select {...fieldProps('fontFamily', fieldIssues)} value={overlay.fontFamily} onChange={(e) => void save({ overlay: { fontFamily: e.currentTarget.value } })}>
                {FONT_CHOICES.some((f) => f.value === overlay.fontFamily) ? null : <option value={overlay.fontFamily}>Personalizada</option>}
                {FONT_CHOICES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label for="width">
              Ancho (px)
              <input {...fieldProps('width', fieldIssues)} type="number" min="200" max="3000" value={overlay.width} onChange={(e) => void save({ overlay: { width: num(e) } })} />
              <FieldError id="width" issues={fieldIssues} />
            </label>
            <label for="maxLines">
              Líneas de traducción visibles (1 a 6)
              <input {...fieldProps('maxLines', fieldIssues)} type="number" min="1" max="6" value={overlay.maxLines} onChange={(e) => void save({ overlay: { maxLines: num(e) } })} />
              <FieldError id="maxLines" issues={fieldIssues} />
            </label>
            <label for="hideAfter">
              Ocultar tras (segundos, 0 = no ocultar)
              <input
                {...fieldProps('hideAfter', fieldIssues)}
                type="number"
                min="0"
                max="600"
                value={Math.round(overlay.hideAfterMs / 1000)}
                onChange={(e) => void save({ overlay: { hideAfterMs: Math.round(num(e) * 1000) } })}
              />
              <FieldError id="hideAfter" issues={fieldIssues} />
            </label>
          </fieldset>

          <fieldset id="colors">
            <legend>Colores</legend>
            <div class="row">
              <label for="textColor" class="inline">
                Texto
                <input {...fieldProps('textColor', fieldIssues, 'contrast')} type="color" value={colors.text} onChange={(e) => void changeColor({ text: e.currentTarget.value })} />
              </label>
              <label for="backgroundColor" class="inline">
                Fondo
                <input {...fieldProps('backgroundColor', fieldIssues)} type="color" value={colors.bg} onChange={(e) => void changeColor({ bg: e.currentTarget.value })} />
              </label>
            </div>
            <p id="textColor-hint" class={`hint ${contrast.ok ? '' : 'field-error'}`} aria-live="polite">
              <span id="contrast">{contrast.text}</span>
            </p>
            <FieldError id="textColor" issues={fieldIssues} />
            <FieldError id="backgroundColor" issues={fieldIssues} />
            <p class="hint">El contraste se calcula con el color de fondo opaco; con poca opacidad sobre un escritorio claro puede leerse peor.</p>
          </fieldset>

          <fieldset id="position">
            <legend>Posición</legend>
            <button type="button" id="move-overlay" aria-pressed={moving} onClick={() => void toggleMove()}>
              {moving ? 'Terminar de mover' : 'Mover el overlay…'}
            </button>
            <p class="hint">
              {moving
                ? 'Arrastra el cuadro de texto en pantalla y pulsa «Listo» (o «Terminar de mover»). La posición queda como manual.'
                : 'Muestra el overlay para arrastrarlo con el ratón a donde prefieras.'}
            </p>
            <label class="inline">
              <input type="radio" name="placement" id="placement-auto" checked={overlay.placement === 'auto'} onChange={() => void save({ overlay: { placement: 'auto' } })} />
              Automática (fuera de la región traducida)
            </label>
            <label class="inline">
              <input type="radio" name="placement" id="placement-manual" checked={overlay.placement === 'manual'} onChange={() => void save({ overlay: { placement: 'manual' } })} />
              Manual
            </label>
            {overlay.placement === 'manual' && (
              <details id="position-coords">
                <summary>Coordenadas exactas (X, Y)</summary>
                <div class="row">
                  <label for="overlay-x">
                    X (px)
                    <input {...fieldProps('overlay-x', fieldIssues)} type="number" value={overlay.x} onChange={(e) => void save({ overlay: { x: num(e) } })} />
                  </label>
                  <label for="overlay-y">
                    Y (px)
                    <input {...fieldProps('overlay-y', fieldIssues)} type="number" value={overlay.y} onChange={(e) => void save({ overlay: { y: num(e) } })} />
                  </label>
                </div>
              </details>
            )}
          </fieldset>
        </TabPanel>

        <TabPanel id="shortcuts" active={tab}>
          <fieldset>
            <legend>Atajos de teclado</legend>
            <label for="shortcut-select">
              Elegir región
              <input {...fieldProps('shortcut-select', fieldIssues)} type="text" value={settings.shortcuts.selectRegion} onChange={(e) => void save({ shortcuts: { selectRegion: e.currentTarget.value } })} />
              <FieldError id="shortcut-select" issues={fieldIssues} />
            </label>
            <label for="shortcut-pause">
              Pausar o reanudar
              <input {...fieldProps('shortcut-pause', fieldIssues)} type="text" value={settings.shortcuts.togglePause} onChange={(e) => void save({ shortcuts: { togglePause: e.currentTarget.value } })} />
              <FieldError id="shortcut-pause" issues={fieldIssues} />
            </label>
            <label for="shortcut-mode">
              Cambiar de modo
              <input {...fieldProps('shortcut-mode', fieldIssues)} type="text" value={settings.shortcuts.toggleMode} onChange={(e) => void save({ shortcuts: { toggleMode: e.currentTarget.value } })} />
              <FieldError id="shortcut-mode" issues={fieldIssues} />
            </label>
            <p class="hint">Formato: teclas separadas por «+», por ejemplo CommandOrControl+Shift+T.</p>
          </fieldset>
        </TabPanel>

        <TabPanel id="advanced" active={tab}>
          <fieldset>
            <legend>Motores (solo para pruebas)</legend>
            <p class="hint">Los motores de demostración no necesitan modelos y no traducen de verdad: sirven para probar la aplicación. Se aplica al empezar la siguiente traducción.</p>
            <label class="inline">
              <input type="radio" name="engines" value="real" checked={settings.engines === 'real'} onChange={() => void save({ engines: 'real' })} />
              Local (OCR y traducción en este equipo)
            </label>
            <label class="inline">
              <input type="radio" name="engines" value="fake" checked={settings.engines === 'fake'} onChange={() => void save({ engines: 'fake' })} />
              Demostración (sin modelos)
            </label>
          </fieldset>

          <fieldset id="performance">
            <legend>Rendimiento</legend>
            <p class="hint">«0» deja que el programa decida. Los cambios se aplican al empezar la siguiente traducción.</p>
            <label for="perf-threads">
              Hilos de cálculo (0 = automático, hasta 64)
              <input {...fieldProps('perf-threads', fieldIssues)} type="number" min="0" max="64" value={perf.intraThreads} onChange={(e) => void save({ performance: { intraThreads: num(e) } })} />
              <FieldError id="perf-threads" issues={fieldIssues} />
            </label>
            <label for="perf-beam">
              Anchura de búsqueda de la traducción (0 = por defecto, hasta 8)
              <input {...fieldProps('perf-beam', fieldIssues)} type="number" min="0" max="8" value={perf.beamWidth} onChange={(e) => void save({ performance: { beamWidth: num(e) } })} />
              <FieldError id="perf-beam" issues={fieldIssues} />
            </label>
            <label for="perf-cache">
              Caché de traducciones (0 = por defecto, desde 16)
              <input {...fieldProps('perf-cache', fieldIssues)} type="number" min="0" max="1000000" value={perf.cacheCapacity} onChange={(e) => void save({ performance: { cacheCapacity: num(e) } })} />
              <FieldError id="perf-cache" issues={fieldIssues} />
            </label>
            <label for="perf-ocr-side">
              Tamaño de análisis del OCR en píxeles (0 = por defecto, de 160 a 4000)
              <input {...fieldProps('perf-ocr-side', fieldIssues)} type="number" min="0" max="4000" value={perf.ocrMaxSide} onChange={(e) => void save({ performance: { ocrMaxSide: num(e) } })} />
              <FieldError id="perf-ocr-side" issues={fieldIssues} />
            </label>
            <p class="hint">Menos píxeles es más rápido y usa menos memoria, pero puede no leer letra pequeña.</p>
            <label class="inline" for="perf-lowmem">
              <input id="perf-lowmem" type="checkbox" checked={perf.lowMemory} onChange={(e) => void save({ performance: { lowMemory: e.currentTarget.checked } })} />
              Priorizar la memoria sobre la velocidad
            </label>
          </fieldset>

          <fieldset id="transfer">
            <legend>Copia de las preferencias</legend>
            <p class="hint">Se guardan solo las preferencias (idiomas, apariencia, atajos…). Nunca la región, carpetas ni textos capturados o traducidos.</p>
            <div class="row">
              <button type="button" id="export-settings" onClick={() => void exportPrefs()}>
                Exportar…
              </button>
              <button type="button" id="import-settings" onClick={() => void importPrefs()}>
                Importar…
              </button>
            </div>
          </fieldset>

          <fieldset id="reset">
            <legend>Valores por defecto</legend>
            <p class="hint">Restablece las preferencias. No cambia la región elegida ni la carpeta de modelos.</p>
            {confirmReset ? (
              <div role="group" aria-label="Confirmar restablecer" class="row">
                <button type="button" id="confirm-reset" class="danger" onClick={() => void reset()}>
                  Sí, restablecer
                </button>
                <button type="button" id="cancel-reset" onClick={() => setConfirmReset(false)}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" id="reset-settings" onClick={() => setConfirmReset(true)}>
                Restablecer…
              </button>
            )}
          </fieldset>
        </TabPanel>
      </Tabs>
    </main>
  )
}

const root = document.getElementById('app')
if (root) render(api ? <App api={api} /> : <p role="alert">No se pudo conectar con la aplicación.</p>, root)
