// Prueba de humo del selector de región (TR_SMOKE=selector): ventana real, ratón y teclado simulados
// con `sendInputEvent`, y la región física resultante. No imprime contenido.

import type { BrowserWindow } from 'electron'

import { monitorIndex } from '../shared/geometry.ts'
import type { SavedRegion } from '../shared/settings.ts'
import type { RegionPicker, DisplaySource } from './region-picker.ts'
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

type Mouse = { x: number; y: number; button?: 'left' | 'right' }

function mouse(window: BrowserWindow, type: 'mouseDown' | 'mouseMove' | 'mouseUp', point: Mouse): void {
  window.webContents.sendInputEvent({ type, x: point.x, y: point.y, button: point.button ?? 'left', clickCount: 1 })
}

function key(window: BrowserWindow, keyCode: string): void {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
}

async function rectState(window: BrowserWindow): Promise<{ hidden: boolean; previous: boolean; x: number; y: number; w: number; h: number }> {
  return (await window.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('rect')
    return { hidden: el.hidden, previous: el.classList.contains('previous'),
      x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }
  })()`)) as { hidden: boolean; previous: boolean; x: number; y: number; w: number; h: number }
}

export async function runSelectorSmoke(windows: WindowManager, picker: RegionPicker, displays: DisplaySource, last: { value: SavedRegion | null }): Promise<void> {
  const scale = displays.underCursor().scaleFactor
  const monitor = monitorIndex(displays.all(), displays.underCursor())

  // 1. Arrastrar y soltar devuelve la región física (escala aplicada) del monitor correcto.
  let pick = picker.pick()
  await waitFor(() => windows.get('selector') !== undefined, 'the selector window')
  let window = windows.get('selector')!
  await sleep(300)
  mouse(window, 'mouseDown', { x: 100, y: 80 })
  mouse(window, 'mouseMove', { x: 250, y: 150 })
  await sleep(100)
  const dragging = await rectState(window)
  expect(!dragging.hidden && !dragging.previous && Math.round(dragging.w) === 150 && Math.round(dragging.h) === 70, 'el rectángulo se dibuja mientras se arrastra')
  mouse(window, 'mouseMove', { x: 400, y: 200 })
  mouse(window, 'mouseUp', { x: 400, y: 200 })
  const region = await pick
  expect(region !== null, 'el arrastre confirma una región')
  expect(
    region?.x === Math.round(100 * scale) && region?.y === Math.round(80 * scale) && region?.width === Math.round(400 * scale) - Math.round(100 * scale) && region?.height === Math.round(200 * scale) - Math.round(80 * scale) && region?.monitor === monitor,
    `región física inesperada: ${JSON.stringify(region)}`,
  )
  expect(windows.get('selector') === undefined, 'la ventana se cierra al confirmar')
  ok('arrastrar y soltar devuelve la región física y cierra la ventana')
  last.value = region

  // 2. Escape cancela y no cambia la región.
  pick = picker.pick()
  await waitFor(() => windows.get('selector') !== undefined, 'the selector window')
  window = windows.get('selector')!
  await sleep(300)
  key(window, 'Escape')
  expect((await pick) === null, 'Escape cancela')
  expect(windows.get('selector') === undefined, 'la ventana se cierra al cancelar')
  ok('Escape cancela y cierra la ventana')

  // 3. Un clic sin arrastre no confirma; la región anterior se muestra y Enter la reutiliza.
  pick = picker.pick()
  await waitFor(() => windows.get('selector') !== undefined, 'the selector window')
  window = windows.get('selector')!
  await waitFor(async () => !(await rectState(window)).hidden, 'the previous region to be drawn')
  const previous = await rectState(window)
  expect(previous.previous, 'la región anterior se dibuja con el estilo de "anterior"')
  expect(Math.abs(previous.x - 100) <= 1 / scale && Math.abs(previous.w - 300) <= 1 / scale, `la región anterior se muestra en DIP: ${JSON.stringify(previous)}`)
  mouse(window, 'mouseDown', { x: 500, y: 300 })
  mouse(window, 'mouseUp', { x: 500, y: 300 })
  await sleep(200)
  expect(windows.get('selector') !== undefined && picker.isOpen, 'un clic sin arrastre no cierra el selector')
  key(window, 'Enter')
  const reused = await pick
  expect(JSON.stringify(reused) === JSON.stringify(last.value), `Enter reutiliza la región anterior: ${JSON.stringify(reused)}`)
  ok('un clic sin arrastre se ignora y Enter reutiliza la región anterior')

  // 4. Pedir el selector dos veces a la vez comparte el mismo (solo hay uno).
  const [a, b] = [picker.pick(), picker.pick()]
  await waitFor(() => windows.get('selector') !== undefined && !windows.get('selector')!.webContents.isLoading(), 'the selector to load')
  expect(windows.openCount === 1, 'solo hay una ventana de selector')
  windows.get('selector')!.close()
  expect((await a) === null && (await b) === null, 'cerrar la ventana equivale a cancelar')
  ok('una única instancia y cerrar la ventana cancela')

  // 5. Cerrarlo mientras todavía carga tampoco falla: es una cancelación.
  const early = picker.pick()
  await waitFor(() => windows.get('selector') !== undefined, 'the selector window')
  windows.get('selector')!.destroy()
  expect((await early) === null, 'cerrar durante la carga cancela sin error')
  ok('cerrar el selector durante la carga cancela sin error')
}
