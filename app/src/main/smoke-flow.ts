// Prueba de humo del flujo selector -> ajustes -> motor (TR_SMOKE=flow), con motores de demostración:
// elegir una región con el ratón inicia la traducción, la región queda guardada y, tras "reiniciar"
// (almacén y controlador nuevos sobre el mismo archivo), se reutiliza sin volver a elegirla.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BrowserWindow } from 'electron'

import { monitorIndex } from '../shared/geometry.ts'
import type { SavedRegion } from '../shared/settings.ts'
import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import { ModelsService } from './models-service.ts'
import { OverlayPicker } from './overlay-picker.ts'
import { RegionPicker } from './region-picker.ts'
import type { DisplaySource } from './region-picker.ts'
import { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (condition()) return
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function drag(window: BrowserWindow): void {
  const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, y: number) =>
    window.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
  send('mouseDown', 120, 90)
  send('mouseMove', 300, 160)
  send('mouseMove', 420, 210)
  send('mouseUp', 420, 210)
}

export async function runFlowSmoke(host: EngineHost, windows: WindowManager, displays: DisplaySource): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), 'tr-flow-')), 'settings.json')

  // Primera sesión: motores de demostración y sin región guardada.
  const settings = new SettingsStore(file)
  settings.load()
  expect(settings.update({ engines: 'fake' }).ok, 'se pueden guardar los ajustes')
  let controller: AppController
  const models = new ModelsService(host, settings, () => controller.state.running)
  controller = new AppController({ host, windows, settings, picker: new RegionPicker(windows, displays, () => settings.get().lastRegion), overlayPicker: (r, c) => new OverlayPicker(windows, displays, r, c), configure: () => models.configure() })
  host.start()
  await host.whenReady()

  let translations = 0
  controller.on('text', () => translations++)
  const notices: string[] = []
  controller.on('notice', (n) => notices.push(n.message))

  const chosen = controller.chooseRegion()
  await waitFor(() => windows.get('selector') !== undefined && !windows.get('selector')!.webContents.isLoading(), 'the selector')
  await sleep(300)
  const regionWindow = windows.get('selector')!
  drag(regionWindow)
  // Después de la región se elige dónde aparecen los subtítulos (otra ventana de selector).
  await waitFor(() => { const w = windows.get('selector'); return w !== undefined && w !== regionWindow && !w.webContents.isLoading() }, 'the subtitle selector')
  await sleep(300)
  drag(windows.get('selector')!)
  expect(await chosen,`elegir la región inicia la traducción (avisos: ${JSON.stringify(notices)})`)
  await waitFor(() => translations > 0, 'the first translation')
  expect(controller.state.running && !controller.state.paused, 'el controlador queda en marcha')
  ok('elegir una región con el ratón inicia la traducción')

  const saved = JSON.parse(readFileSync(file, 'utf8')).lastRegion as SavedRegion
  const scale = displays.underCursor().scaleFactor
  expect(saved.monitor === monitorIndex(displays.all(), displays.underCursor()) && saved.x === Math.round(120 * scale) && saved.width === Math.round(420 * scale) - Math.round(120 * scale), `la región queda guardada: ${JSON.stringify(saved)}`)
  ok('la región elegida se guarda en los ajustes')
  const overlay = settings.get().overlay
  const bounds = displays.underCursor().bounds
  expect(overlay.placement === 'manual' && overlay.x === bounds.x + 120 && overlay.y === bounds.y + 90 && overlay.width === 300, `el recuadro de subtítulos se guarda: ${JSON.stringify(overlay)}`)
  ok('el recuadro de subtítulos elegido se guarda en los ajustes')

  // Pausa y reanudación llegan al motor: durante la pausa no hay traducciones nuevas.
  await controller.pause()
  expect(controller.state.paused, 'el estado refleja la pausa')
  await sleep(500)
  const whilePaused = translations
  await sleep(1200)
  expect(translations === whilePaused, 'en pausa no llegan traducciones')
  await controller.resume()
  await waitFor(() => translations > whilePaused, 'translations after resume')
  ok('pausar detiene las traducciones y reanudar las devuelve')

  await controller.stop()
  expect(!controller.state.running, 'detener deja el estado en reposo')

  // "Reinicio": almacén y controlador nuevos sobre el mismo archivo; no se vuelve a abrir el selector.
  const restartedSettings = new SettingsStore(file)
  const { warnings } = restartedSettings.load()
  expect(warnings.length === 0, 'los ajustes guardados se leen sin avisos')
  expect(JSON.stringify(restartedSettings.get().lastRegion) === JSON.stringify(saved), 'la última región se recupera tras reiniciar')
  const restartedModels = new ModelsService(host, restartedSettings, () => restarted.state.running)
  const restarted: AppController = new AppController({
    host,
    windows,
    settings: restartedSettings,
    picker: new RegionPicker(windows, displays, () => restartedSettings.get().lastRegion),
    overlayPicker: (r, c) => new OverlayPicker(windows, displays, r, c),
    configure: () => restartedModels.configure(),
  })
  let again = 0
  restarted.on('text', () => again++)
  expect(await restarted.startSaved(), 'se puede iniciar con la región guardada')
  expect(windows.get('selector') === undefined, 'no se abre el selector')
  await waitFor(() => again > 0, 'a translation after the restart')
  ok('tras reiniciar se reutiliza la última región sin volver a elegirla')
  await restarted.stop()
}
