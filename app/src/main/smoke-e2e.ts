// Prueba de punta a punta con motores reales (TR_SMOKE=e2e, necesita TR_MODELS_DIR y un servidor X):
// una ventana de la propia app muestra un texto conocido, el selector devuelve su región, el motor la
// captura, reconoce y traduce, y el overlay muestra la traducción. Bajo WSLg `xcap` no puede capturar
// la pantalla: se ejecuta con `scripts/with-xvfb.sh` (ver `pnpm run smoke:e2e`).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BrowserWindow } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import type { Notice } from '../shared/ipc.ts'
import { AppShell } from './app-shell.ts'
import type { TrayLike } from './app-shell.ts'
import type { EngineHost } from './engine-host.ts'
import type { DisplaySource } from './region-picker.ts'
import { scriptedFiles } from './settings-ipc.ts'
import { SettingsStore } from './settings-store.ts'
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
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const noTray: TrayLike = { update: (_template: MenuItemConstructorOptions[], _tooltip: string) => {}, destroy: () => {} }

/** Ancho y alto de un PNG (cabecera IHDR). */
function pngSize(data: Buffer): { width: number; height: number } {
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

export async function runE2eSmoke(host: EngineHost, windows: WindowManager, displays: DisplaySource): Promise<void> {
  const modelsDir = process.env['TR_MODELS_DIR']
  if (!modelsDir) throw new Error('define TR_MODELS_DIR con la carpeta de modelos (ver tr-models/examples/fetch.rs)')

  // Ventana con el texto conocido, en una posición fija de la pantalla.
  const image = readFileSync(join(__dirname, '..', '..', '..', 'crates', 'tr-adapters', 'tests', 'fixtures', 'en1.png'))
  const { width, height } = pngSize(image)
  const [x, y] = [100, 100]
  const page = new BrowserWindow({ x, y, width, height, useContentSize: true, frame: false, resizable: false, show: false, backgroundColor: '#ffffff' })
  await page.loadURL(`data:text/html;base64,${Buffer.from(`<body style="margin:0"><img src="data:image/png;base64,${image.toString('base64')}" style="display:block"></body>`).toString('base64')}`)
  page.setBounds({ x, y, width, height })
  page.show()
  await sleep(500)
  ok(`ventana con texto conocido en (${x}, ${y}) de ${width}x${height}`)

  const settings = new SettingsStore(join(modelsDir, '..', `tr-e2e-settings-${process.pid}.json`))
  settings.load()
  expect(settings.update({ engines: 'real', from: 'en', targets: ['es'], modelsDir }).ok, 'ajustes')

  const notices: Notice[] = []
  const shell = new AppShell({ host, windows, settings, displays, tray: noTray, shortcuts: { register: () => true, unregister: () => {} }, notify: (n) => notices.push(n), quit: () => {}, files: scriptedFiles(), openOnStart: false })
  shell.start()
  await host.whenReady()

  // El usuario arrastra el ratón sobre el texto en el selector.
  const chosen = shell.controller.chooseRegion()
  await waitFor(() => windows.get('selector') !== undefined && !windows.get('selector')!.webContents.isLoading(), 'the selector', 15_000)
  await sleep(300)
  const selector = windows.get('selector')!
  const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', px: number, py: number) => selector.webContents.sendInputEvent({ type, x: px, y: py, button: 'left', clickCount: 1 })
  send('mouseDown', x, y)
  send('mouseMove', x + Math.round(width / 2), y + Math.round(height / 2))
  send('mouseMove', x + width, y + height)
  send('mouseUp', x + width, y + height)
  expect(await chosen, `elegir la región inicia la traducción (avisos: ${JSON.stringify(notices)})`)
  ok('el selector devuelve la región y el motor real arranca')

  const overlayText = async (): Promise<string> => {
    const overlay = windows.get('overlay')
    if (!overlay) return ''
    return (await overlay.webContents.executeJavaScript(`[...document.querySelectorAll('#tracks .track')].map((p) => p.textContent).join(' ')`)) as string
  }
  await waitFor(async () => /mundo/i.test(await overlayText()), `the translation in the overlay (avisos: ${JSON.stringify(notices)})`, 120_000)
  const translated = await overlayText()
  expect(/prueba/i.test(translated), `traducción al español: ${translated}`)
  const original = (await windows.get('overlay')!.webContents.executeJavaScript(`document.querySelector('#tracks .track.secondary span:last-child')?.textContent ?? ''`)) as string
  expect(original === 'Hello world, this is a test.', `texto original reconocido: ${original}`)
  ok(`el overlay muestra la traducción real: "${translated}"`)

  // Modo automático: sin texto en la región pasa solo a audio y, al volver el texto, regresa.
  const modeLabel = async (): Promise<string> =>
    (await windows.get('overlay')!.webContents.executeJavaScript(`document.getElementById('mode').textContent`)) as string
  expect(shell.controller.state.mode === 'text' && (await modeLabel()) === '', 'la sesión empieza en modo texto (sin etiqueta)')
  page.hide()
  await waitFor(() => shell.controller.state.mode === 'audio', `the fallback to audio (avisos: ${JSON.stringify(notices)})`, 60_000)
  await waitFor(async () => (await modeLabel()) === 'Audio', 'the overlay to show the audio mode')
  ok('al retirar el texto la sesión pasa sola a audio y el overlay lo indica')
  page.show()
  await waitFor(() => shell.controller.state.mode === 'text', 'the return to text mode', 60_000)
  await waitFor(async () => /mundo/i.test(await overlayText()), 'the translation after returning to text', 60_000)
  ok('al volver el texto regresa a modo texto y se traduce de nuevo')

  expect(notices.every((n) => n.level !== 'error'), `sin errores durante la sesión: ${JSON.stringify(notices)}`)
  await shell.controller.stop()
  shell.dispose()
  page.destroy()
}
