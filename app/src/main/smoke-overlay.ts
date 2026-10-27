// Prueba de humo del overlay (TR_SMOKE=overlay): propiedades de la ventana real, colocación fuera de
// la región, texto y estilo en vivo, ocultación automática y que nada del texto se escribe a disco.

import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { toDesktopDip } from '../shared/geometry.ts'
import type { SavedRegion } from '../shared/settings.ts'
import { OverlayController } from './overlay-controller.ts'
import type { DisplaySource } from './region-picker.ts'
import type { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${what}`)
}

interface Dom {
  hidden: boolean
  original: string
  main: string
  provisional: boolean
  opacity: string
  fontSize: string
  originalShown: boolean
}

async function dom(window: Electron.BrowserWindow): Promise<Dom> {
  return (await window.webContents.executeJavaScript(`(() => {
    const box = document.getElementById('box')
    const root = document.documentElement.style
    return {
      hidden: box.hidden,
      original: document.getElementById('original').textContent,
      main: document.getElementById('translated').textContent,
      provisional: box.classList.contains('provisional'),
      opacity: root.getPropertyValue('--opacity'),
      fontSize: root.getPropertyValue('--font-size'),
      originalShown: getComputedStyle(document.getElementById('original')).display !== 'none',
    }
  })()`)) as Dom
}

/** Rutas de archivos bajo `dirs` que contienen alguno de los `needles` (búsqueda de contenido). */
function filesContaining(dirs: string[], needles: string[]): string[] {
  const found: string[] = []
  const patterns = needles.map((n) => Buffer.from(n, 'utf8'))
  const walk = (path: string): void => {
    let stat
    try {
      stat = lstatSync(path) // sin seguir enlaces simbólicos
    } catch {
      return
    }
    if (stat.isDirectory()) {
      let entries: string[]
      try {
        entries = readdirSync(path)
      } catch {
        return // directorio sin permisos (p. ej. /tmp/snap-private-tmp): no es nuestro
      }
      for (const entry of entries) walk(join(path, entry))
    } else if (stat.isFile() && stat.size < 50_000_000) {
      let data: Buffer
      try {
        data = readFileSync(path)
      } catch {
        return
      }
      if (patterns.some((p) => data.includes(p))) found.push(path)
    }
  }
  dirs.forEach(walk)
  return found
}

export async function runOverlaySmoke(windows: WindowManager, settings: SettingsStore, displays: DisplaySource): Promise<void> {
  const controller = new OverlayController(windows, settings, displays)
  const all = displays.all()
  const primary = all.find((d) => d.isPrimary) ?? all[0]!
  const overlaps: boolean[] = []
  controller.on('overlap', (value) => overlaps.push(value))

  // Una región en el tercio superior del monitor principal: el overlay debe ir debajo.
  const scale = primary.scaleFactor
  const region: SavedRegion = { x: Math.round(300 * scale), y: Math.round(100 * scale), width: Math.round(600 * scale), height: Math.round(80 * scale), monitor: 0 }
  const window = await controller.open(region)
  expect(window.isVisible(), 'el overlay está visible')
  expect(window.isAlwaysOnTop(), 'el overlay está siempre encima')
  expect(!window.isFocusable(), 'el overlay no acepta foco')
  expect(!window.isFocused(), 'el overlay no se ha llevado el foco')
  ok('visible, siempre encima y sin foco')

  const desktop = toDesktopDip(region, all)!
  const bounds = window.getBounds()
  const disjoint = bounds.y >= desktop.rect.y + desktop.rect.height || bounds.y + bounds.height <= desktop.rect.y
  expect(disjoint, `el overlay no se superpone con la región: ${JSON.stringify(bounds)} vs ${JSON.stringify(desktop.rect)}`)
  expect(!controller.overlapsRegion, 'sin aviso de solapamiento')
  expect(bounds.width === Math.min(settings.get().overlay.width, primary.workArea.width), 'el ancho sigue a los ajustes')
  ok('ubicado fuera de la región, con el ancho de los ajustes')

  // Texto: original + traducción; un parcial se distingue y el final lo reemplaza.
  controller.show({ original: 'Hello, world', translated: 'Hola, mundo', final: true })
  await waitFor(async () => !(await dom(window)).hidden, 'the overlay text')
  let view = await dom(window)
  expect(view.original === 'Hello, world' && view.main === 'Hola, mundo' && !view.provisional && view.originalShown, `texto inesperado: ${JSON.stringify(view)}`)
  controller.show({ original: 'good morn', translated: null, final: false })
  await waitFor(async () => (await dom(window)).provisional, 'the provisional style')
  view = await dom(window)
  expect(view.main === 'good morn' && view.original === '', 'un parcial sin traducir se muestra como principal')
  controller.show({ original: 'good morning', translated: 'buenos días', final: true })
  await waitFor(async () => !(await dom(window)).provisional, 'the final replacing the provisional')
  ok('muestra original y traducción; el final reemplaza al provisional')

  // La inserción es texto plano: el HTML no se interpreta.
  controller.show({ original: '<img src=x onerror="document.title=1">', translated: '<b>negrita</b>', final: true })
  await waitFor(async () => (await dom(window)).main === '<b>negrita</b>', 'the escaped text')
  expect(!(await window.webContents.executeJavaScript(`document.querySelector('#box img, #box b') !== null`)), 'el texto no crea elementos')
  ok('el texto se inserta como texto, no como HTML')

  // Estilo en vivo: opacidad, fuente y tamaño sin reiniciar.
  expect(settings.update({ overlay: { opacity: 0.4, fontSize: 40, width: 700 } }).ok, 'cambiar el estilo')
  await waitFor(async () => (await dom(window)).opacity === '0.4', 'the live style')
  view = await dom(window)
  expect(view.fontSize === '40px', `tamaño de fuente en vivo: ${view.fontSize}`)
  expect(window.getBounds().width === 700, `el ancho cambia en vivo: ${window.getBounds().width}`)
  ok('opacidad, tamaño de fuente y ancho cambian en vivo')

  // Mostrar u ocultar la línea del original.
  settings.update({ overlay: { showOriginal: false } })
  controller.show({ original: 'Good night', translated: 'Buenas noches', final: true })
  await waitFor(async () => (await dom(window)).main === 'Buenas noches', 'the new text')
  expect((await dom(window)).original === '', 'sin mostrar el original esa línea queda vacía')
  settings.update({ overlay: { showOriginal: true } })

  // Se oculta solo tras un tiempo sin traducciones nuevas.
  settings.update({ overlay: { hideAfterMs: 300 } })
  await sleep(100)
  controller.show({ original: 'Bye', translated: 'Adiós', final: true })
  await waitFor(async () => !(await dom(window)).hidden, 'the text to appear')
  await waitFor(async () => (await dom(window)).hidden, 'the text to hide itself', 3000)
  ok('se oculta solo pasado el tiempo configurado')

  // Posición manual encima de la región: avisa de que se superpone.
  const target = { x: desktop.rect.x + 10, y: desktop.rect.y + 5 }
  settings.update({ overlay: { placement: 'manual', x: Math.round(target.x), y: Math.round(target.y) } })
  expect(controller.overlapsRegion, 'una posición manual sobre la región se advierte')
  expect(overlaps.includes(true), 'se emitió el evento de solapamiento')
  settings.update({ overlay: { placement: 'auto' } })
  expect(!controller.overlapsRegion, 'volver a la posición automática quita el aviso')
  ok('una posición manual sobre la región se advierte')

  // Nada de lo mostrado se escribe a disco: se busca el texto en la carpeta de datos de la aplicación.
  const needles = ['Hola, mundo', 'buenos días', 'Buenas noches', 'negrita']
  const dirs = [app.getPath('userData'), app.getPath('temp')].filter((p, i, a) => a.indexOf(p) === i)
  await sleep(300)

  // Control positivo: el escáner debe encontrar un archivo que sí contiene el texto.
  const control = join(app.getPath('userData'), 'zz-leak-control.txt')
  writeFileSync(control, 'Hola, mundo')
  const detected = filesContaining(dirs, needles)
  rmSync(control)
  expect(detected.length === 1 && detected[0] === control, `el escáner de fugas no detecta un archivo sembrado: ${JSON.stringify(detected)}`)

  const leaks = filesContaining(dirs, needles)
  // El propio archivo de resultados de esta prueba no existe: cualquier coincidencia es una fuga real.
  expect(leaks.length === 0, `texto mostrado encontrado en disco: ${leaks.join(', ')}`)
  ok('el texto mostrado no aparece en ningún archivo de la carpeta de datos ni de temporales')

  controller.close()
  expect(windows.get('overlay') === undefined, 'cerrar libera la ventana')
}
