// Prueba de humo de las ventanas de producto (TR_SMOKE=windows): aislamiento, política de contenido
// y ciclo de vida. Imprime solo resultados (nunca contenido).

import { app } from 'electron'
import type { BrowserWindow, WebPreferences } from 'electron'

import type { WindowKind, WindowManager } from './windows.ts'

const API_OF: Record<WindowKind, { global: string; keys: string[] }> = {
  selector: { global: 'trSelector', keys: ['cancel', 'confirm', 'nextDisplay', 'onInit'] },
  overlay: { global: 'trOverlay', keys: ['drag', 'endMove', 'onClear', 'onMode', 'onMoveMode', 'onShow', 'onStyle'] },
  settings: {
    global: 'trSettings',
    keys: [
      'cancelDownload',
      'chooseRegion',
      'deleteModel',
      'downloadModels',
      'exportSettings',
      'getAppState',
      'getSettings',
      'importSettings',
      'listAudioSources',
      'modelCatalog',
      'modelInventory',
      'modelStatus',
      'moveOverlay',
      'onAppState',
      'onAudioLevel',
      'onModelProgress',
      'onMonitorState',
      'onMoveState',
      'onNotice',
      'onSettingsChanged',
      'pauseSession',
      'pickModelsDir',
      'pickOverlayPosition',
      'pickRegion',
      'resetSettings',
      'restartSession',
      'resumeSession',
      'showOverlayPosition',
      'showRegion',
      'startSession',
      'stopSession',
      'updateSettings',
      'validateModelsDir',
      'voiceThreshold',
      'watchAudioLevel',
    ],
  },
}

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function inPage<T>(window: BrowserWindow, code: string): Promise<T> {
  return (await window.webContents.executeJavaScript(code)) as T
}

async function openKind(windows: WindowManager, kind: WindowKind): Promise<BrowserWindow> {
  if (kind === 'selector') {
    const { screen } = await import('electron')
    return windows.openSelector(screen.getPrimaryDisplay(), { show: false })
  }
  return kind === 'overlay' ? windows.openOverlay({ show: false }) : windows.openSettings({ show: false })
}

// `getLastWebPreferences` existe en Electron pero falta en sus declaraciones de tipos (44.x).
type WithPreferences = { getLastWebPreferences(): WebPreferences | undefined }

async function checkIsolation(window: BrowserWindow, kind: WindowKind): Promise<void> {
  const prefs = (window.webContents as unknown as WithPreferences).getLastWebPreferences()
  expect(prefs?.contextIsolation === true, `${kind}: contextIsolation debe estar activado`)
  expect(prefs?.sandbox === true, `${kind}: sandbox debe estar activado`)
  expect(prefs?.nodeIntegration === false, `${kind}: nodeIntegration debe estar desactivado`)

  const mine = API_OF[kind]
  const probe = await inPage<Record<string, unknown>>(
    window,
    `({
      require: typeof require,
      process: typeof process,
      module: typeof module,
      buffer: typeof Buffer,
      electron: typeof window.electron,
      ipc: typeof window.ipcRenderer,
      api: Object.keys(window.${mine.global} ?? {}).sort(),
      foreign: ${JSON.stringify(Object.values(API_OF).map((a) => a.global).filter((g) => g !== mine.global))}.filter((g) => typeof window[g] !== 'undefined'),
    })`,
  )
  for (const name of ['require', 'process', 'module', 'buffer', 'electron', 'ipc'] as const) {
    expect(probe[name] === 'undefined', `${kind}: "${name}" no debe existir en la página (es ${String(probe[name])})`)
  }
  expect(JSON.stringify(probe['api']) === JSON.stringify(mine.keys), `${kind}: la API expuesta es ${JSON.stringify(probe['api'])}`)
  expect((probe['foreign'] as string[]).length === 0, `${kind}: ve APIs de otras ventanas`)
}

async function checkContentPolicy(window: BrowserWindow, kind: WindowKind): Promise<void> {
  const csp = await inPage<string | null>(window, `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null`)
  expect(csp?.includes("default-src 'none'") === true && csp.includes("connect-src 'none'"), `${kind}: falta la política de contenido estricta`)

  const inlineRan = await inPage<boolean>(
    window,
    `new Promise((resolve) => {
      const script = document.createElement('script')
      script.textContent = 'window.__inlineRan = true'
      document.head.appendChild(script)
      setTimeout(() => resolve(window.__inlineRan === true), 50)
    })`,
  )
  expect(!inlineRan, `${kind}: un script inline no debería ejecutarse`)

  const fetched = await inPage<string>(window, `fetch('https://example.com/').then(() => 'allowed', () => 'blocked')`)
  expect(fetched === 'blocked', `${kind}: fetch debería estar bloqueado por la política`)
}

export async function runWindowsSmoke(windows: WindowManager): Promise<void> {
  const kinds: WindowKind[] = ['selector', 'overlay', 'settings']

  for (const kind of kinds) {
    const window = await openKind(windows, kind)
    await checkIsolation(window, kind)
    await checkContentPolicy(window, kind)
    ok(`${kind}: aislada (sin Node), API mínima, política de contenido estricta`)
  }

  // Una sola instancia de cada ventana.
  const again = await windows.openSettings({ show: false })
  expect(again === windows.get('settings'), 'abrir dos veces devuelve la misma ventana')
  expect(windows.openCount === 3, `deberían ser 3 ventanas y hay ${windows.openCount}`)
  ok('una única instancia por tipo')

  // Cerrar una ventana la libera y se puede volver a abrir.
  windows.close('overlay')
  expect(windows.get('overlay') === undefined && windows.openCount === 2, 'cerrar el overlay lo libera')
  const reopened = await windows.openOverlay({ show: false })
  expect(!reopened.isDestroyed(), 'se puede volver a abrir')
  ok('cerrar y reabrir una ventana')

  // Cerrar todo no deja ventanas ni procesos de renderer.
  windows.closeAll()
  expect(windows.openCount === 0, 'closeAll deja 0 ventanas del gestor')
  await new Promise((resolve) => setTimeout(resolve, 800))
  const renderers = app.getAppMetrics().filter((m) => m.type === 'Tab')
  expect(renderers.length === 0, `quedan ${renderers.length} procesos de renderer`)
  ok('sin ventanas ni procesos de renderer tras cerrar')
}
