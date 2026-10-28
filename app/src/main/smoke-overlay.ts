// Prueba de humo del overlay (TR_SMOKE=overlay): propiedades de la ventana real, colocación fuera de
// la región, texto y estilo en vivo, ocultación automática y que nada del texto se escribe a disco.

import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { toDesktopDip } from '../shared/geometry.ts'
import type { OverlayText } from '../shared/ipc.ts'
import { overlayHeight, trackPlan } from '../shared/overlay-layout.ts'
import type { SavedRegion } from '../shared/settings.ts'
import { OverlayController } from './overlay-controller.ts'
import { registerOverlayIpc } from './overlay-ipc.ts'
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

/** Texto del overlay con un original (`lang: 'en'`) y, si hay, una traducción al español. */
const text = (original: string, translated: string | null, final: boolean): OverlayText => ({
  original,
  lang: 'en',
  translations: translated === null ? [] : [{ lang: 'es', text: translated }],
  final,
})

interface Dom {
  hidden: boolean
  /** Líneas de arriba abajo; `original` y `main` son atajos para las pruebas de una traducción. */
  lines: { lang: string; text: string; secondary: boolean; tag: string }[]
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
    const lines = [...document.querySelectorAll('#tracks .track')].map((p) => ({
      lang: p.lang,
      text: p.querySelector('span:last-child').textContent,
      secondary: p.classList.contains('secondary'),
      tag: p.querySelector('.lang-tag')?.textContent ?? '',
    }))
    const secondary = lines.find((l) => l.secondary)
    return {
      hidden: box.hidden,
      lines,
      original: secondary ? secondary.text : '',
      main: lines.length > 0 ? lines[lines.length - 1].text : '',
      provisional: box.classList.contains('provisional'),
      opacity: root.getPropertyValue('--opacity'),
      fontSize: root.getPropertyValue('--font-size'),
      originalShown: secondary !== undefined,
    }
  })()`)) as Dom
}

let current: Electron.BrowserWindow | undefined

function currentWindow(): Electron.BrowserWindow {
  if (!current) throw new Error('no overlay window')
  return current
}

async function colors(): Promise<{ text: string; background: string; clamp: string; truncated: boolean; height: number }> {
  return (await currentWindow().webContents.executeJavaScript(`(() => {
    const box = document.getElementById('box')
    const t = document.querySelector('.track:not(.secondary)')
    return {
      text: getComputedStyle(box).color,
      background: getComputedStyle(box).backgroundColor,
      clamp: getComputedStyle(t).webkitLineClamp,
      truncated: t.scrollHeight > t.clientHeight + 1,
      height: t.clientHeight,
    }
  })()`)) as { text: string; background: string; clamp: string; truncated: boolean; height: number }
}

async function moveView(): Promise<{ visible: boolean; bar: boolean; text: string }> {
  return (await currentWindow().webContents.executeJavaScript(`(() => ({
    visible: !document.getElementById('box').hidden,
    bar: !document.getElementById('move-bar').hidden,
    text: document.querySelector('.track span:last-child')?.textContent ?? '',
  }))()`)) as { visible: boolean; bar: boolean; text: string }
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
  current = window
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
  controller.show(text('Hello, world', 'Hola, mundo', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the overlay text')
  let view = await dom(window)
  expect(view.original === 'Hello, world' && view.main === 'Hola, mundo' && !view.provisional && view.originalShown, `texto inesperado: ${JSON.stringify(view)}`)
  controller.show(text('good morn', null, false))
  await waitFor(async () => (await dom(window)).provisional, 'the provisional style')
  view = await dom(window)
  expect(view.main === 'good morn' && view.original === '', 'un parcial sin traducir se muestra como principal')
  controller.show(text('good morning', 'buenos días', true))
  await waitFor(async () => !(await dom(window)).provisional, 'the final replacing the provisional')
  ok('muestra original y traducción; el final reemplaza al provisional')

  // Indicador de modo: la etiqueta muestra solo el nombre; con la caja oculta aparece unos segundos.
  const label = () => window.webContents.executeJavaScript(`({ text: document.getElementById('mode').textContent, hidden: document.getElementById('box').hidden })`) as Promise<{ text: string; hidden: boolean }>
  controller.clear()
  await waitFor(async () => (await label()).hidden, 'the box to hide')
  controller.setMode('audio')
  await waitFor(async () => (await label()).text === 'Audio' && !(await label()).hidden, 'the audio label to flash')
  controller.setMode('paused')
  await waitFor(async () => (await label()).text === 'Pausa', 'the paused label')
  controller.setMode('text')
  await waitFor(async () => (await label()).text === 'Texto', 'the text label')
  controller.show(text('a', 'b', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the text after the label')
  expect((await label()).text === 'Texto', 'la etiqueta acompaña al texto')
  ok('el indicador de modo muestra el nombre del modo y aparece aunque no haya texto')

  // La inserción es texto plano: el HTML no se interpreta.
  controller.show(text('<img src=x onerror="document.title=1">', '<b>negrita</b>', true))
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
  controller.show(text('Good night', 'Buenas noches', true))
  await waitFor(async () => (await dom(window)).main === 'Buenas noches', 'the new text')
  expect((await dom(window)).original === '', 'sin mostrar el original esa línea queda vacía')
  settings.update({ overlay: { showOriginal: true } })

  // Se oculta solo tras un tiempo sin traducciones nuevas.
  settings.update({ overlay: { hideAfterMs: 300 } })
  await sleep(100)
  controller.show(text('Bye', 'Adiós', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the text to appear')
  await waitFor(async () => (await dom(window)).hidden, 'the text to hide itself', 3000)
  ok('se oculta solo pasado el tiempo configurado')

  // Mantener la traducción: en modo texto no se oculta por tiempo; en audio sí.
  settings.update({ overlay: { hideAfterMs: 300, keepWhileUnchanged: true } })
  controller.setTextMode(true)
  await sleep(100)
  controller.show(text('Stay', 'Quédate', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the kept text to appear')
  await sleep(900)
  expect(!(await dom(window)).hidden, 'con el ajuste, en modo texto, la traducción sigue visible pasado el tiempo')
  controller.clear()
  await waitFor(async () => (await dom(window)).hidden, 'the kept text to be cleared')
  ok('con «mantener la traducción» el texto sigue visible hasta que se retira')
  controller.setTextMode(false)
  await sleep(100)
  controller.show(text('Audio', 'Audio', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the audio text to appear')
  await waitFor(async () => (await dom(window)).hidden, 'the audio text to hide itself', 3000)
  settings.update({ overlay: { keepWhileUnchanged: false } })
  ok('en modo audio sigue valiendo el tiempo de ocultado')

  // Colores y límite de líneas.
  expect(settings.update({ overlay: { textColor: '#ffee00', backgroundColor: '#102030', opacity: 1, maxLines: 1, fontSize: 30, width: 400, hideAfterMs: 0 } }).ok, 'cambiar colores y líneas')
  controller.show(text('Hello', 'Esta es una traducción muy larga que no cabe en una sola línea de la ventana del overlay y debe cortarse', true))
  await waitFor(async () => !(await dom(window)).hidden, 'the long text')
  await waitFor(async () => (await colors()).text === 'rgb(255, 238, 0)', 'the text colour')
  const look = await colors()
  expect(look.background === 'rgb(16, 32, 48)', `fondo: ${look.background}`)
  expect(look.clamp === '1' && look.truncated && look.height <= 30 * 1.3 * 1.5, `una línea con el resto cortado: ${JSON.stringify(look)}`)
  // ±1 DIP: con escala de pantalla fraccionaria (p. ej. 150 % en Windows) el alto se redondea a píxeles físicos.
  const plan = () => trackPlan(settings.get().targets, settings.get().overlay.showOriginal)
  expect(Math.abs(window.getBounds().height - overlayHeight(30, 1, plan())) <= 1, `el alto de la ventana sigue al límite: ${window.getBounds().height}`)
  settings.update({ overlay: { maxLines: 3 } })
  await waitFor(async () => (await colors()).clamp === '3' && (await colors()).height > look.height * 2, 'three lines to be shown')
  expect(Math.abs(window.getBounds().height - overlayHeight(30, 3, plan())) <= 1, `alto con tres líneas: ${window.getBounds().height}`)
  settings.update({ overlay: { maxLines: 2, width: 700, hideAfterMs: 300 } })
  ok('colores y límite de líneas se aplican en vivo y la ventana ajusta su alto')

  // Dos subtítulos: se ven los dos, con su etiqueta de idioma, y caben en la ventana y en la pantalla.
  const longText = 'Esta es una traducción larga que ocupa varias líneas de la ventana del overlay para comprobar que entran dos subtítulos completos'
  const fitness = () =>
    currentWindow().webContents.executeJavaScript(`(() => {
      const ps = [...document.querySelectorAll('#tracks .track')]
      const limit = window.innerHeight + 1
      return {
        tracks: ps.length,
        tags: document.querySelectorAll('.lang-tag').length,
        langs: ps.map((p) => p.lang),
        fits: document.getElementById('box').getBoundingClientRect().bottom <= limit && ps.every((p) => p.getBoundingClientRect().bottom <= limit),
        lines: ps.map((p) => Math.round(p.clientHeight / parseFloat(getComputedStyle(p).lineHeight))),
        inner: window.innerHeight,
        boxBottom: Math.round(document.getElementById('box').getBoundingClientRect().bottom),
        bottoms: ps.map((p) => Math.round(p.getBoundingClientRect().bottom)),
        fontSize: getComputedStyle(document.getElementById('box')).fontSize,
      }
    })()`) as Promise<{ tracks: number; tags: number; langs: string[]; fits: boolean; lines: number[]; inner: number; boxBottom: number; bottoms: number[]; fontSize: string }>
  const twoSubtitles: OverlayText = {
    original: 'Hello',
    lang: 'en',
    translations: [
      { lang: 'es', text: longText },
      { lang: 'fr', text: longText },
    ],
    final: true,
  }
  expect(settings.update({ targets: ['es', 'fr'], overlay: { showOriginal: false, fontSize: 28, maxLines: 2, width: 700, hideAfterMs: 0 } }).ok, 'dos traducciones')
  controller.show(twoSubtitles)
  // La ventana y el estilo llegan al renderer de forma asíncrona: se espera a que se asienten.
  await waitFor(async () => (await fitness()).tracks === 2, 'the two subtitles')
  await waitFor(async () => (await fitness()).fits, 'the two subtitles to fit in the window', 3000).catch(async () => {
    throw new Error(`dos traducciones no caben: ${JSON.stringify(await fitness())}`)
  })
  let fit = await fitness()
  expect(fit.langs.join() === 'es,fr' && fit.tags === 2 && fit.fits, `dos traducciones: ${JSON.stringify(fit)}`)
  expect(fit.lines.every((n) => n === 2), `cuatro líneas en total con la fuente por defecto: ${JSON.stringify(fit)}`)
  expect(window.getBounds().height <= primary.workArea.height * 0.45 + 1, 'el overlay no pasa del 45 % de la pantalla')

  // Original más una traducción: el original va arriba, pequeño y rotulado.
  expect(settings.update({ targets: ['es'], overlay: { showOriginal: true } }).ok, 'original y traducción')
  controller.show({ ...twoSubtitles, translations: [{ lang: 'es', text: longText }] })
  await waitFor(async () => (await dom(window)).lines.length === 2 && (await dom(window)).lines[0]!.secondary, 'the original above the translation')
  view = await dom(window)
  expect(view.lines.map((l) => l.tag).join() === 'EN,ES' && view.lines[0]!.lang === 'en' && view.lines[1]!.lang === 'es', `etiquetas: ${JSON.stringify(view.lines)}`)
  await waitFor(async () => (await fitness()).fits, 'the original and translation to fit in the window', 3000).catch(async () => {
    throw new Error(`original y traducción no caben: ${JSON.stringify(await fitness())}`)
  })

  // Peor caso: fuente de 96 px y 6 líneas por subtítulo. Se reducen las líneas, ambos se ven y entran.
  expect(settings.update({ targets: ['es', 'fr'], overlay: { showOriginal: false, fontSize: 96, maxLines: 6, width: 900 } }).ok, 'peor caso')
  controller.show(twoSubtitles)
  await waitFor(async () => (await fitness()).tracks === 2 && (await fitness()).lines.every((n) => n < 6) && (await fitness()).fits, 'the worst case to fit', 3000).catch(async () => {
    throw new Error(`peor caso: ambos subtítulos deben verse dentro de la ventana: ${JSON.stringify(await fitness())}`)
  })
  fit = await fitness()
  expect(fit.fits && fit.lines.every((n) => n >= 1), `peor caso: ${JSON.stringify(fit)}`)
  expect(settings.get().overlay.maxLines === 6, 'el ajuste guardado no se modifica')
  expect(window.getBounds().height <= primary.workArea.height, `la ventana cabe en la pantalla: ${window.getBounds().height}`)
  expect(settings.update({ targets: ['es'], overlay: { showOriginal: true, fontSize: 30, maxLines: 2, width: 700, hideAfterMs: 300 } }).ok, 'volver al estilo anterior')
  ok('dos subtítulos: etiquetados, en orden y dentro de la ventana, también con fuente de 96 px y 6 líneas')

  // Modo mover: la ventana acepta el ratón, se arrastra y se fija la posición; fuera del modo no se mueve.
  const disposeIpc = registerOverlayIpc({ windows, overlay: controller, isRunning: () => true })
  const still = window.getBounds()
  await window.webContents.executeJavaScript('window.trOverlay.drag(50, 50)')
  await sleep(150)
  expect(window.getBounds().x === still.x && window.getBounds().y === still.y, 'fuera del modo mover el arrastre se ignora')
  controller.clear()
  await waitFor(async () => (await dom(window)).hidden, 'the box to hide before moving')
  await controller.beginMove()
  expect(controller.moving, 'modo mover activo')
  await waitFor(async () => (await moveView()).visible && (await moveView()).bar, 'the move handle')
  expect((await moveView()).text === 'Aquí aparecerá la traducción', 'texto de ejemplo en el modo mover')
  const start = window.getBounds()
  await window.webContents.executeJavaScript('window.trOverlay.drag(40, 25)')
  await waitFor(() => window.getBounds().x === start.x + 40 && window.getBounds().y === start.y + 25, 'the window to follow the drag')
  await window.webContents.executeJavaScript('window.trOverlay.drag(-100000, -100000)')
  await waitFor(() => window.getBounds().y === primary.workArea.y, 'the drag to stay on screen')
  expect(window.getBounds().x + window.getBounds().width >= primary.workArea.x + 48, 'siempre queda un trozo visible')
  await window.webContents.executeJavaScript('window.trOverlay.drag(100000, 100000)')
  // Con varios monitores el límite inferior es el de la pantalla más baja, no el del principal.
  const lowest = Math.max(...all.map((d) => d.workArea.y + d.workArea.height))
  await waitFor(() => window.getBounds().y <= lowest - 48, 'the drag to stay on screen (bottom)').catch(() => {
    throw new Error(`el arrastre hacia abajo no se mantiene en pantalla: ${JSON.stringify(window.getBounds())} (límite ${lowest})`)
  })
  const atEdge = window.getBounds()
  await window.webContents.executeJavaScript('window.trOverlay.drag(-300, -300)')
  await waitFor(() => window.getBounds().x === atEdge.x - 300 && window.getBounds().y === atEdge.y - 300, 'the window to come back from the edge')
  // Arrastre con el puntero: los eventos llevan la posición en pantalla (screenX/Y) y la ventana sigue el desplazamiento.
  const beforePointer = window.getBounds()
  await window.webContents.executeJavaScript(`(() => {
    const box = document.getElementById('box')
    const fire = (type, x, y) => box.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, screenX: x, screenY: y }))
    fire('pointerdown', 500, 400)
    fire('pointermove', 520, 410)
    fire('pointermove', 530, 420)
    fire('pointerup', 530, 420)
    fire('pointermove', 900, 900)
  })()`)
  await waitFor(() => window.getBounds().x === beforePointer.x + 30 && window.getBounds().y === beforePointer.y + 20, `the pointer to drag the window by (30, 20), now ${JSON.stringify(window.getBounds())}`)
  await sleep(150)
  expect(window.getBounds().x === beforePointer.x + 30, 'tras soltar, mover el puntero no arrastra')
  await window.webContents.executeJavaScript(`document.getElementById('move-done').click()`)
  await waitFor(() => !controller.moving, 'the move mode to end')
  const saved = settings.get().overlay
  const finalBounds = window.getBounds()
  expect(saved.placement === 'manual' && saved.x === finalBounds.x && saved.y === finalBounds.y, `posición manual guardada: ${JSON.stringify(saved)} vs ${JSON.stringify(finalBounds)}`)
  await waitFor(async () => (await dom(window)).hidden && !(await moveView()).bar, 'the placeholder to disappear')
  await window.webContents.executeJavaScript('window.trOverlay.drag(30, 30)')
  await sleep(150)
  expect(window.getBounds().x === finalBounds.x && window.getBounds().y === finalBounds.y, 'terminado el modo, el arrastre vuelve a ignorarse')
  disposeIpc()
  settings.update({ overlay: { placement: 'auto' } })
  ok('el modo mover arrastra el overlay, lo mantiene en pantalla, guarda la posición manual y vuelve a ignorar el ratón')

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
