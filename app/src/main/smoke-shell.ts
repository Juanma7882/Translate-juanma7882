// Prueba de humo del ensamblaje del producto (TR_SMOKE=shell): bandeja, atajos, overlay y primer uso,
// con la bandeja y los atajos globales sustituidos por dobles (WSLg no los tiene) y todo lo demás real.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MenuItemConstructorOptions } from 'electron'

import type { Notice } from '../shared/ipc.ts'
import type { SavedRegion } from '../shared/settings.ts'
import { AppShell } from './app-shell.ts'
import type { TrayLike } from './app-shell.ts'
import type { EngineHost } from './engine-host.ts'
import type { DisplaySource } from './region-picker.ts'
import { SettingsStore } from './settings-store.ts'
import { startFixture } from './smoke-settings.ts'
import type { WindowManager } from './windows.ts'

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${what}`)
}

class FakeTray implements TrayLike {
  template: MenuItemConstructorOptions[] = []
  tooltip = ''
  destroyed = false
  update(template: MenuItemConstructorOptions[], tooltip: string): void {
    this.template = template
    this.tooltip = tooltip
  }
  destroy(): void {
    this.destroyed = true
  }
  /** Invoca el elemento de menú cuya etiqueta empieza por `prefix`. */
  click(prefix: string): void {
    const item = this.template.find((i) => i.label?.startsWith(prefix))
    if (!item || item.enabled === false) throw new Error(`el elemento "${prefix}" no está disponible en el menú`)
    ;(item.click as () => void)()
  }
  /** Elige una opción del submenú "Modo" por su etiqueta. */
  clickMode(label: string): void {
    const submenu = this.template.find((i) => i.label === 'Modo')?.submenu as MenuItemConstructorOptions[] | undefined
    const item = submenu?.find((i) => i.label === label)
    if (!item) throw new Error(`no hay una opción de modo "${label}"`)
    ;(item.click as () => void)()
  }
  /** Etiqueta de la opción de modo marcada. */
  checkedMode(): string | undefined {
    const submenu = this.template.find((i) => i.label === 'Modo')?.submenu as MenuItemConstructorOptions[] | undefined
    return submenu?.find((i) => i.checked)?.label
  }
  has(prefix: string): boolean {
    return this.template.some((i) => i.label?.startsWith(prefix) && i.enabled !== false)
  }
}

class FakeShortcuts {
  readonly active = new Map<string, () => void>()
  constructor(private readonly taken: string[]) {}
  register(accelerator: string, callback: () => void): boolean {
    if (this.taken.includes(accelerator)) return false
    this.active.set(accelerator, callback)
    return true
  }
  unregister(accelerator: string): void {
    this.active.delete(accelerator)
  }
}

function region(displays: DisplaySource): SavedRegion {
  const scale = (displays.all().find((d) => d.isPrimary) ?? displays.all()[0]!).scaleFactor
  return { x: Math.round(200 * scale), y: Math.round(100 * scale), width: Math.round(400 * scale), height: Math.round(80 * scale), monitor: 0 }
}

export async function runShellSmoke(host: EngineHost, windows: WindowManager, displays: DisplaySource): Promise<void> {
  // ---------------------------------------------------------------- bandeja, atajos y overlay (motores de demostración)
  const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'tr-shell-')), 'settings.json'))
  settings.load()
  expect(settings.update({ engines: 'fake', lastRegion: region(displays), shortcuts: { togglePause: 'Alt+Taken' } }).ok, 'ajustes iniciales')

  const tray = new FakeTray()
  const shortcuts = new FakeShortcuts(['Alt+Taken'])
  const notices: Notice[] = []
  const shell = new AppShell({ host, windows, settings, displays, tray, shortcuts, notify: (n) => notices.push(n), quit: () => notices.push({ level: 'info', message: 'quit' }) })
  shell.start()
  await host.whenReady()

  // Atajo en conflicto: se avisa con el atajo y qué hacer; el otro sí queda registrado.
  expect(notices.some((n) => n.level === 'warning' && n.message.includes('Alt+Taken') && n.message.includes('Ajustes')), `aviso de atajo en conflicto: ${JSON.stringify(notices)}`)
  expect(shortcuts.active.has('CommandOrControl+Shift+T') && !shortcuts.active.has('Alt+Taken'), 'solo el atajo libre queda registrado')
  settings.update({ shortcuts: { togglePause: 'Alt+Free' } })
  expect(shortcuts.active.has('Alt+Free') && shortcuts.active.size === 3, 'al cambiar el atajo se vuelve a registrar')
  ok('un atajo en conflicto se informa y uno libre se registra al cambiarlo')

  // Bandeja en reposo.
  expect(tray.has('Traducir') && !tray.has('Pausar') && !tray.has('Detener'), 'en reposo solo se puede traducir')
  expect(tray.tooltip.includes('reposo'), 'la bandeja indica reposo')

  let texts = 0
  shell.controller.on('text', () => texts++)
  tray.click('Traducir la última región')
  await waitFor(() => shell.controller.state.running && texts > 0, 'the first translation')
  const overlay = windows.get('overlay')
  expect(overlay !== undefined && overlay.isVisible(), 'el overlay se abre al traducir')
  await waitFor(async () => ((await overlay!.webContents.executeJavaScript(`document.getElementById('translated').textContent`)) as string).length > 0, 'the overlay text')
  expect(tray.has('Pausar') && tray.has('Detener') && !tray.has('Traducir'), 'en marcha se puede pausar y detener')
  ok('"Traducir la última región" inicia la traducción y el overlay muestra el texto')

  // Pausa desde el menú y reanudación con el atajo: el motor deja de emitir y vuelve a hacerlo.
  tray.click('Pausar')
  await waitFor(() => shell.controller.state.paused, 'the paused state')
  expect(tray.has('Reanudar') && tray.tooltip.includes('pausa'), 'el menú ofrece reanudar')
  await sleep(500)
  const whilePaused = texts
  await sleep(1200)
  expect(texts === whilePaused, 'en pausa no llegan traducciones')
  shortcuts.active.get('Alt+Free')!()
  await waitFor(() => !shell.controller.state.paused, 'resume through the shortcut')
  await waitFor(() => texts > whilePaused, 'translations after resume')
  ok('pausar desde el menú detiene el motor y el atajo lo reanuda')

  // ---- Modos: el menú y el atajo alternan entre automático, solo audio y solo texto en caliente.
  const originals: string[] = []
  shell.controller.on('text', (t) => originals.push(t.original))
  const overlayText = (selector: string) => overlay!.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).textContent`) as Promise<string>
  const SCREEN = ['Hello, world', 'Where is the station?', 'Thank you very much']
  const SPEECH = ['Good morning everyone', 'Welcome to the demo', 'See you tomorrow']
  const nextOriginals = async (from: number, pool: string[], what: string) => {
    await waitFor(() => originals.length > from && originals.slice(from).some((o) => pool.includes(o)), what)
    expect(originals.slice(from).every((o) => pool.includes(o)), `solo llegan textos del modo esperado (${what}): ${originals.slice(from)}`)
  }

  expect(tray.checkedMode() === 'Automático' && shell.controller.state.mode === 'text', 'en automático la sesión empieza en texto')
  expect(tray.tooltip.includes('texto'), `el tooltip indica el modo activo: ${tray.tooltip}`)
  await waitFor(async () => (await overlayText('#mode')) === 'Texto', 'the mode label to read Texto')

  // Menú: solo audio. La sesión sigue, ahora con subtítulos del audio y la etiqueta cambia.
  let mark = 0
  tray.clickMode('Solo audio')
  await waitFor(() => shell.controller.state.mode === 'audio' && shell.controller.state.running, 'audio mode through the tray')
  expect(settings.get().mode === 'audio' && tray.checkedMode() === 'Solo audio', 'el ajuste y la bandeja reflejan el modo')
  await sleep(300) // deja pasar lo que el motor anterior ya había emitido
  mark = originals.length
  await nextOriginals(mark, SPEECH, 'audio subtitles')
  await waitFor(async () => (await overlayText('#mode')) === 'Audio', 'the mode label to read Audio')
  expect(tray.tooltip.includes('audio'), 'el tooltip indica audio')
  expect(windows.get('overlay') === overlay, 'el overlay no se cierra al cambiar de modo')
  ok('elegir "Solo audio" en la bandeja reinicia la sesión en audio y el overlay lo indica')

  // Pausa en solo audio: la captura se detiene y al reanudar vuelven los subtítulos.
  tray.click('Pausar')
  await waitFor(() => shell.controller.state.paused, 'pause in audio mode')
  await sleep(600)
  mark = originals.length
  await sleep(1200)
  expect(originals.length === mark, 'en pausa no llegan subtítulos')
  tray.click('Reanudar')
  await waitFor(() => !shell.controller.state.paused, 'resume in audio mode')
  await nextOriginals(mark, SPEECH, 'subtitles after resume')
  ok('pausar y reanudar funcionan en solo audio')

  // Atajo: audio -> automático (texto de pantalla) -> texto -> audio.
  const toggle = shortcuts.active.get('CommandOrControl+Shift+M')!
  mark = originals.length
  toggle()
  await waitFor(() => settings.get().mode === 'auto' && shell.controller.state.mode === 'text', 'auto mode through the shortcut')
  await sleep(300)
  mark = originals.length
  await nextOriginals(mark, SCREEN, 'screen text after the shortcut')
  toggle()
  await waitFor(() => settings.get().mode === 'text' && shell.controller.state.mode === 'text', 'text-only mode through the shortcut')
  await waitFor(async () => (await overlayText('#mode')) === 'Texto', 'the label in text-only mode')
  toggle()
  await waitFor(() => settings.get().mode === 'audio' && shell.controller.state.mode === 'audio', 'audio mode again through the shortcut')
  expect(tray.checkedMode() === 'Solo audio', 'la bandeja marca el modo del atajo')
  ok('el atajo cicla automático, solo texto y solo audio con la sesión en marcha')

  // Vuelta a automático para el resto de la prueba.
  tray.clickMode('Automático')
  await waitFor(() => shell.controller.state.mode === 'text' && settings.get().mode === 'auto', 'back to auto')
  await sleep(300)
  mark = originals.length
  await nextOriginals(mark, SCREEN, 'screen text in auto mode')

  tray.click('Detener')
  await waitFor(() => !shell.controller.state.running, 'stop')
  await waitFor(() => windows.get('overlay') === undefined, 'the overlay to close')
  expect(tray.tooltip.includes('reposo'), 'la bandeja vuelve a reposo')
  tray.click('Salir')
  expect(notices.some((n) => n.message === 'quit'), 'Salir pide cerrar la aplicación')
  ok('detener cierra el overlay y deja la bandeja en reposo; salir pide cerrar')

  shell.dispose()
  expect(tray.destroyed && shortcuts.active.size === 0, 'cerrar libera la bandeja y los atajos')

  // ---------------------------------------------------------------- primer uso (motores reales, servidor local)
  const fixture = await startFixture()
  try {
    const firstSettings = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'tr-shell-first-')), 'settings.json'))
    firstSettings.load()
    const modelsDir = mkdtempSync(join(tmpdir(), 'tr-shell-models-'))
    expect(firstSettings.update({ engines: 'real', from: 'en', to: 'es', lastRegion: region(displays) }).ok, 'ajustes de primer uso')
    const firstNotices: Notice[] = []
    const first = new AppShell({
      host,
      windows,
      settings: firstSettings,
      displays,
      tray: new FakeTray(),
      shortcuts: new FakeShortcuts([]),
      notify: (n) => firstNotices.push(n),
      quit: () => {},
      engineOverrides: () => ({ modelsDir, manifestPath: fixture.manifestPath }),
    })
    first.start()
    await host.whenReady()

    let resumed = 0
    const original = first.controller.startSaved.bind(first.controller)
    first.controller.startSaved = () => {
      resumed++
      return original()
    }

    // Sin modelos: avisa, abre Ajustes y no deja nada a medias.
    expect(!(await first.controller.startSaved()), 'sin modelos no se puede traducir')
    resumed = 0
    expect(firstNotices.some((n) => n.code === 'models-missing'), `aviso de modelos ausentes: ${JSON.stringify(firstNotices)}`)
    await waitFor(() => windows.get('settings') !== undefined, 'the settings window')
    const settingsWindow = windows.get('settings')!
    await waitFor(async () => (await settingsWindow.webContents.executeJavaScript(`document.getElementById('download') !== null`)) as boolean, 'the download button')
    const offer = (await settingsWindow.webContents.executeJavaScript(`document.getElementById('models').textContent`)) as string
    expect(/internet/.test(offer) && /\d/.test(offer), `la oferta explica la descarga y su tamaño: ${offer}`)
    ok('sin modelos se avisa, se abre Ajustes y se ofrece descargar con su tamaño')

    // En automático (el modo por defecto) el aviso lista a la vez los modelos de texto y de audio.
    const missing = firstNotices.find((n) => n.code === 'models-missing')!.message
    expect(/missing models: o, t, s\b|missing models: (?=.*\bo\b)(?=.*\bt\b)(?=.*\bs\b)/.test(missing), `el aviso lista los modelos de texto y de audio: ${missing}`)
    ok('en modo automático se avisa de los modelos de texto y de audio juntos')

    // Una descarga parcial (solo los de audio) no reintenta: siguen faltando los de texto.
    await waitFor(async () => (await settingsWindow.webContents.executeJavaScript(`document.getElementById('download-audio') !== null`)) as boolean, 'the audio download button')
    await settingsWindow.webContents.executeJavaScript(`document.getElementById('download-audio').click()`)
    await waitFor(async () => (await settingsWindow.webContents.executeJavaScript(`document.getElementById('audio-models-ready') !== null`)) as boolean, 'the audio models to be ready')
    await sleep(800)
    expect(resumed === 0, 'con los modelos de texto aún sin descargar no se reintenta')
    ok('una descarga parcial no reintenta el arranque')

    // Al terminar la descarga de lo que faltaba se retoma lo que se quería hacer.
    await settingsWindow.webContents.executeJavaScript(`document.getElementById('download').click()`)
    await waitFor(() => resumed > 0, 'the translation to resume after the download', 20_000)
    ok('al terminar la descarga se reintenta la traducción pendiente')

    await first.controller.stop()
    first.dispose()
  } finally {
    fixture.server.close()
    fixture.server.closeAllConnections()
    windows.closeAll()
  }
}
