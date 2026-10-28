// Prueba de humo de la ventana de Ajustes (TR_SMOKE=settings): la interfaz real (Preact) sobre el
// motor real, con descargas contra un servidor HTTP local y un manifiesto propio (sin internet).
// Cubre idiomas según el catálogo, pestañas y accesibilidad, cambios que se guardan y se aplican
// en vivo, validación en línea, la gestión de modelos (avance, error con reintento, cancelar,
// reanudar con Range, borrar, espacio y carpeta), colores, rendimiento, importar/exportar,
// restablecer y el tema claro/oscuro.

import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nativeTheme, session as electronSession } from 'electron'
import type { BrowserWindow } from 'electron'

import type { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import { ModelsService } from './models-service.ts'
import { OverlayController } from './overlay-controller.ts'
import { registerOverlayIpc } from './overlay-ipc.ts'
import type { DisplaySource } from './region-picker.ts'
import { registerSettingsIpc, scriptedFiles } from './settings-ipc.ts'
import { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'
import { defaultSettings } from '../shared/settings.ts'

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(15)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

const FILES: Record<string, Buffer> = {
  'a.bin': Buffer.from(Array.from({ length: 150_000 }, (_, i) => i % 251)),
  'b.bin': Buffer.from('model-b'),
  'c.bin': Buffer.from('model-c-data'),
  'd.bin': Buffer.from('model-d-stt-data'),
}

export interface Fixture {
  server: Server
  manifestPath: string
  /** Mientras sea `true`, el servidor responde 500 a todo. */
  failing: { value: boolean }
  /** Si no es `null`, la próxima descarga completa de `a.bin` se corta tras esos bytes (red caída). */
  cutAfter: { value: number | null }
  /** Cabecera `Range` de cada petición a `a.bin` (`null` si no traía). */
  ranges: (string | null)[]
}

/** Servidor local con un manifiesto de modelos de juguete, para ejercitar descargas sin internet. */
export async function startFixture(): Promise<Fixture> {
  const failing = { value: false }
  const cutAfter: { value: number | null } = { value: null }
  const ranges: (string | null)[] = []
  const server = createServer((req, res) => {
    const name = (req.url ?? '').slice(1)
    const body = FILES[name]
    if (!body || failing.value) {
      res.writeHead(body ? 500 : 404).end()
      return
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : null
    if (name === 'a.bin') ranges.push(range)
    const start = range ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0) : 0
    const rest = body.subarray(start)
    if (start > 0) res.writeHead(206, { 'content-length': rest.length, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` })
    else res.writeHead(200, { 'content-length': rest.length })
    const limit = name === 'a.bin' && start === 0 && cutAfter.value !== null ? cutAfter.value : rest.length
    if (name === 'a.bin' && start === 0) cutAfter.value = null
    let offset = 0
    const pump = (): void => {
      if (offset >= limit) {
        if (limit < rest.length) res.destroy()
        else res.end()
        return
      }
      res.write(rest.subarray(offset, Math.min(offset + 10_000, limit)))
      offset += 10_000
      setTimeout(pump, 30)
    }
    pump()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const entry = (name: string) => `{"name":"${name}","url":"http://127.0.0.1:${port}/${name}","sha256":"${sha256(FILES[name]!)}","size":${FILES[name]!.length}}`
  const json = `{"version":1,"models":{"o":{"files":[${entry('a.bin')}]},"t":{"files":[${entry('b.bin')},${entry('c.bin')}]},"s":{"files":[${entry('d.bin')}]}},"ocr":{"en":"o"},"stt":{"en":"s"},"translate":{"en-es":"t"}}`
  const manifestPath = join(mkdtempSync(join(tmpdir(), 'tr-settings-manifest-')), 'models.json')
  writeFileSync(manifestPath, json)
  return { server, manifestPath, failing, cutAfter, ranges }
}

const evaluate = <T>(window: BrowserWindow, code: string): Promise<T> => window.webContents.executeJavaScript(code) as Promise<T>

/** Cambia el valor de un control como lo haría el usuario y avisa con el evento `change`. */
function setControl(window: BrowserWindow, selector: string, value: string | boolean): Promise<void> {
  const prop = typeof value === 'boolean' ? 'checked' : 'value'
  return evaluate(
    window,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.${prop} = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })) })()`,
  )
}

const click = (window: BrowserWindow, selector: string) => evaluate(window, `document.querySelector(${JSON.stringify(selector)}).click()`)
const text = (window: BrowserWindow, selector: string) => evaluate<string>(window, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)
const exists = (window: BrowserWindow, selector: string) => evaluate<boolean>(window, `document.querySelector(${JSON.stringify(selector)}) !== null`)
const attr = (window: BrowserWindow, selector: string, name: string) => evaluate<string | null>(window, `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`)

export async function runSettingsSmoke(host: EngineHost, windows: WindowManager, _displays: DisplaySource): Promise<void> {
  const fixture = await startFixture()
  try {
    const dir = mkdtempSync(join(tmpdir(), 'tr-settings-'))
    const file = join(dir, 'settings.json')
    const settings = new SettingsStore(file)
    settings.load()
    expect(settings.update({ engines: 'real', from: 'en', to: 'es' }).ok, 'ajustes iniciales')

    const modelsDir = mkdtempSync(join(tmpdir(), 'tr-settings-models-'))
    // Una sesión simulada: el controlador real no hace falta para probar los bloqueos de la interfaz.
    const session = Object.assign(new EventEmitter(), { state: { running: false, paused: false, mode: null as null } })
    const controller = session as unknown as AppController
    // Si el usuario elige una carpeta en Ajustes, manda; si no, la de la prueba.
    const models = new ModelsService(host, settings, () => session.state.running, () => ({ manifestPath: fixture.manifestPath, ...(settings.get().modelsDir ? {} : { modelsDir }) }))
    host.start()
    await host.whenReady()
    const files = scriptedFiles()
    const overlay = new OverlayController(windows, settings, _displays)
    const disposeSettings = registerSettingsIpc({ windows, settings, models, host, controller, files })
    const disposeOverlay = registerOverlayIpc({ windows, overlay, isRunning: () => session.state.running })
    const dispose = () => {
      disposeSettings()
      disposeOverlay()
    }

    // La guía de primer uso recuerda en localStorage que terminó; cada ejecución parte de un perfil limpio.
    await electronSession.defaultSession.clearStorageData({ storages: ['localstorage'] })
    const window = await windows.openSettings({ show: false })
    await waitFor(() => exists(window, '#models li'), 'the model list')

    // Los idiomas ofrecidos salen del catálogo del motor (solo en -> es en este manifiesto) y se gestionan en un único sitio.
    await waitFor(() => exists(window, '#languages li[data-pair]'), 'the language list')
    const pairs = await evaluate<string[]>(window, `[...document.querySelectorAll('#languages li[data-pair]')].map(li => li.dataset.pair)`)
    expect(JSON.stringify(pairs) === '["en>es"]', `pares del catálogo: ${pairs}`)
    expect(!(await exists(window, '#from')) && !(await exists(window, '#to')), 'General ya no duplica los selectores de idioma')
    expect(await evaluate<boolean>(window, `document.getElementById('panel-advanced').querySelector('input[name=engines]') !== null`), 'Motores está en Avanzado')
    expect(!(await evaluate<boolean>(window, `document.getElementById('panel-general').querySelector('input[name=engines]') !== null`)), 'Motores ya no está en General')
    ok('los idiomas salen del catálogo, se eligen en un solo sitio y Motores vive en Avanzado')

    // Inicio: sin modelos ni región la guía muestra los tres pasos y destaca el primero.
    await waitFor(() => exists(window, '#first-run'), 'the first-run guide')
    expect((await evaluate<string[]>(window, `[...document.querySelectorAll('#first-run li')].map(li => li.dataset.step)`)).join() === 'language,region,start', 'la guía tiene tres pasos')
    expect(await evaluate<boolean>(window, `document.querySelector('#first-run li.current').dataset.step === 'language'`), 'se destaca el primer paso pendiente')
    expect((await text(window, '#region-text')).includes('Falta'), 'Inicio avisa de que falta la región')
    expect((await text(window, '#choose-region')).includes('Elegir región'), 'el botón dice «Elegir región»')
    expect(await evaluate<boolean>(window, `document.getElementById('pair-select').selectedOptions[0].textContent.includes('sin instalar')`), 'el par activo figura sin instalar')
    ok('Inicio guía el primer uso: tres pasos, región pendiente y par sin instalar')

    // Accesibilidad: cada control con etiqueta, fieldsets con leyenda y progreso con nombre accesible.
    const unlabeled = await evaluate<string[]>(
      window,
      `[...document.querySelectorAll('input, select')].filter(el => el.labels.length === 0 && !el.getAttribute('aria-label')).map(el => el.id || el.name)`,
    )
    expect(unlabeled.length === 0, `controles sin etiqueta: ${unlabeled}`)
    const bare = await evaluate<number>(window, `[...document.querySelectorAll('fieldset')].filter(f => !f.querySelector(':scope > legend')).length`)
    expect(bare === 0, 'todos los grupos tienen leyenda')
    const order = await evaluate<boolean>(window, `[...document.querySelectorAll('[tabindex]')].every(el => Number(el.getAttribute('tabindex')) <= 0)`)
    expect(order, 'sin tabindex positivo: el orden de tabulación sigue el del documento')
    const live = await evaluate<boolean>(
      window,
      `document.getElementById('notice').getAttribute('aria-live') === 'polite' && document.getElementById('status').getAttribute('aria-live') === 'polite' && document.getElementById('errors').getAttribute('role') === 'alert'`,
    )
    expect(live, 'avisos con aria-live y errores con role=alert')
    ok('controles con etiqueta, grupos con leyenda, orden de tabulación natural y regiones aria-live')

    // Pestañas: roles WAI-ARIA, una sola en el orden de tabulación y navegación con el teclado.
    const tabs = await evaluate<string[]>(window, `[...document.querySelectorAll('[role=tab]')].map(t => t.id)`)
    expect(tabs.join() === 'tab-home,tab-languages,tab-general,tab-models,tab-appearance,tab-shortcuts,tab-advanced', `pestañas: ${tabs}`)
    const stops = await evaluate<number>(window, `[...document.querySelectorAll('[role=tab]')].filter(t => t.tabIndex === 0).length`)
    expect(stops === 1, 'solo la pestaña activa está en el orden de tabulación')
    const key = (k: string) => evaluate(window, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
    await click(window, '#tab-general')
    await evaluate(window, `document.getElementById('tab-general').focus()`)
    await key('ArrowRight')
    await waitFor(async () => (await attr(window, '#tab-models', 'aria-selected')) === 'true', 'the models tab to be selected')
    expect(await evaluate<boolean>(window, `document.activeElement.id === 'tab-models'`), 'el foco acompaña a la pestaña')
    expect(await evaluate<boolean>(window, `document.getElementById('panel-models').hidden === false && document.getElementById('panel-general').hidden === true`), 'solo se ve el panel activo')
    expect((await attr(window, '#tab-models', 'aria-controls')) === 'panel-models' && (await attr(window, '#panel-models', 'aria-labelledby')) === 'tab-models', 'pestaña y panel asociados')
    await key('End')
    await waitFor(async () => (await attr(window, '#tab-advanced', 'aria-selected')) === 'true', 'End to go to the last tab')
    await key('ArrowRight')
    await waitFor(async () => (await attr(window, '#tab-home', 'aria-selected')) === 'true', 'the tabs to wrap around')
    await key('Home')
    await key('ArrowLeft')
    await waitFor(async () => (await attr(window, '#tab-advanced', 'aria-selected')) === 'true', 'ArrowLeft to wrap backwards')
    await click(window, '#tab-models')
    ok('las pestañas se navegan con flechas, Inicio y Fin, y el foco las acompaña')

    // Modelos faltantes: se ofrece descargar, con el tamaño total.
    expect(await exists(window, '#download'), 'hay botón de descarga')
    expect(!(await exists(window, '#models-ready')), 'aún no están listos')
    expect((await text(window, '#models')).includes('falta'), 'los modelos figuran como faltantes')
    expect(await exists(window, '#installed-empty'), 'sin modelos instalados todavía')

    // Descarga con error: se muestra, y se puede reintentar.
    fixture.failing.value = true
    await click(window, '#download')
    await waitFor(async () => await exists(window, '#models [role=alert]'), 'the download error')
    expect(await evaluate<boolean>(window, `document.getElementById('download').textContent.includes('Reintentar')`), 'el botón pasa a "Reintentar"')
    expect(!(await exists(window, '#models-ready')), 'con error no figura como listo')
    ok('un fallo de descarga se muestra y ofrece reintentar')

    // Reintento: el avance sube sin retroceder hasta que todo queda listo.
    fixture.failing.value = false
    const samples: number[] = []
    await click(window, '#download')
    await waitFor(async () => {
      const value = await evaluate<number | null>(window, `document.getElementById('download-progress')?.value ?? null`)
      if (value !== null) samples.push(value)
      return await exists(window, '#models-ready')
    }, 'the models to be ready', 20_000)
    expect(samples.length > 0 && samples.every((v, i) => i === 0 || v >= samples[i - 1]!), `el avance no retrocede: ${samples}`)
    expect(Math.max(...samples) > 0, `el avance se movió: ${samples}`)
    expect(!(await exists(window, '#download')), 'ya no se ofrece descargar')
    ok('la descarga avanza sin retroceder y termina en "listo"')

    // Modelos instalados: espacio por modelo y total.
    await waitFor(async () => (await evaluate<number>(window, `document.querySelectorAll('#installed li[data-model]').length`)) === 3, 'three installed models')
    const total = 150_000 + 7 + 12 + 16
    const shown = await text(window, '#installed-total')
    expect(shown.includes('Espacio ocupado') && shown.includes('150'), `espacio total mostrado: ${shown}`)
    expect((await text(window, '#installed li[data-model=o]')).includes('150 KB'), 'espacio del modelo de OCR')
    const onDisk = readdirSync(join(modelsDir, 'o'))
    expect(onDisk.join() === 'a.bin', `archivos del modelo en disco: ${onDisk}`)
    expect(statSync(join(modelsDir, 'o', 'a.bin')).size + 7 + 12 + 16 === total, 'el total coincide con el disco')
    ok('la lista de instalados muestra el espacio de cada modelo y el total')

    // Borrar con confirmación (y cancelar la confirmación no borra).
    await click(window, '#installed li[data-model=o] [data-action=delete]')
    await waitFor(() => exists(window, '#installed li[data-model=o] [data-action=confirm-delete]'), 'the delete confirmation')
    await click(window, '#installed li[data-model=o] [data-action=cancel-delete]')
    await waitFor(async () => !(await exists(window, '#installed li[data-model=o] [data-action=confirm-delete]')), 'the confirmation to close')
    expect(existsSync(join(modelsDir, 'o', 'a.bin')), 'cancelar la confirmación no borra')
    await click(window, '#installed li[data-model=o] [data-action=delete]')
    await waitFor(() => exists(window, '#installed li[data-model=o] [data-action=confirm-delete]'), 'the delete confirmation again')
    await click(window, '#installed li[data-model=o] [data-action=confirm-delete]')
    await waitFor(async () => !(await exists(window, '#installed li[data-model=o]')), 'the model to disappear from the list')
    expect(!existsSync(join(modelsDir, 'o')), 'la carpeta del modelo se eliminó del disco')
    expect(existsSync(join(modelsDir, 't', 'b.bin')) && existsSync(join(modelsDir, 's', 'd.bin')), 'los demás modelos siguen intactos')
    await waitFor(async () => (await text(window, '#status')).includes('liberaron'), 'the freed-space announcement')
    await waitFor(async () => await exists(window, '#download'), 'the download button to come back')
    expect(!(await exists(window, '#models-ready')), 'sin el modelo, el par ya no está listo')
    ok('un modelo se borra con confirmación, libera el espacio y no toca a los demás')

    // Cancelar una descarga a medias conserva lo descargado.
    fixture.ranges.length = 0
    await click(window, '#download')
    await waitFor(async () => (await evaluate<number>(window, `document.getElementById('download-progress')?.value ?? 0`)) > 5, 'progress beyond 5%')
    await click(window, '#cancel-download')
    await waitFor(() => exists(window, '#download-cancelled'), 'the cancellation message')
    const part = join(modelsDir, 'o', 'a.bin.part')
    expect(existsSync(part) && statSync(part).size > 0 && statSync(part).size < 150_000, 'queda un parcial a medias en disco')
    expect(!existsSync(join(modelsDir, 'o', 'a.bin')), 'no hay archivo final')
    await waitFor(async () => (await text(window, '#installed li[data-model=o]')).includes('a medias'), 'the partial in the installed list')
    expect(await evaluate<boolean>(window, `document.getElementById('download').textContent.includes('Reanudar')`), 'el botón pasa a "Reanudar"')
    ok('cancelar conserva el parcial y la interfaz ofrece reanudar')

    // Reanudar: el servidor recibe Range y la huella final se verifica.
    const partial = statSync(part).size
    await click(window, '#download')
    await waitFor(() => exists(window, '#models-ready'), 'the resumed download to finish', 20_000)
    expect(fixture.ranges.length === 2 && fixture.ranges[0] === null && fixture.ranges[1] === `bytes=${partial}-`, `peticiones de a.bin: ${JSON.stringify(fixture.ranges)}`)
    expect(sha256(readFileSync(join(modelsDir, 'o', 'a.bin'))) === sha256(FILES['a.bin']!), 'el archivo reanudado coincide con la huella')
    expect(!existsSync(part), 'el parcial desaparece al completar')
    ok('reanudar pide solo lo que falta (Range) y verifica el archivo completo')

    // Red caída a mitad: se informa, queda el parcial y se reanuda.
    await click(window, '#installed li[data-model=o] [data-action=delete]')
    await waitFor(() => exists(window, '#installed li[data-model=o] [data-action=confirm-delete]'), 'the delete confirmation for the cut test')
    await click(window, '#installed li[data-model=o] [data-action=confirm-delete]')
    await waitFor(async () => await exists(window, '#download'), 'the download button after deleting')
    fixture.ranges.length = 0
    fixture.cutAfter.value = 60_000
    await click(window, '#download')
    await waitFor(async () => await exists(window, '#models [role=alert]'), 'the network error')
    expect(statSync(part).size === 60_000, 'tras el corte quedan 60 000 bytes')
    await click(window, '#download')
    await waitFor(() => exists(window, '#models-ready'), 'the download to finish after the cut', 20_000)
    expect(fixture.ranges[1] === 'bytes=60000-', `reanudó donde cortó: ${JSON.stringify(fixture.ranges)}`)
    ok('un corte de red deja el parcial y se reanuda desde ahí')

    // Con una traducción en marcha no se borra ni se cambia la carpeta.
    session.state = { running: true, paused: false, mode: null }
    session.emit('state', session.state)
    // La guía de primer uso se completa sola (modelos listos, región guardada, sesión vista) y no vuelve.
    expect(settings.update({ lastRegion: { x: 10, y: 20, width: 300, height: 80, monitor: 0 } }).ok, 'región de prueba')
    await click(window, '#tab-home')
    await waitFor(async () => !(await exists(window, '#first-run')), 'the guide to disappear')
    expect((await text(window, '#region-text')).includes('300 × 80'), 'Inicio muestra la región guardada')
    expect((await text(window, '#choose-region')).includes('Cambiar región'), 'el botón pasa a «Cambiar región»')
    expect(await evaluate<boolean>(window, `document.getElementById('pair-select').disabled`), 'con la sesión en marcha el menú de idiomas se desactiva')
    await click(window, '#tab-models')
    await waitFor(async () => (await attr(window, '#installed li[data-model=t] [data-action=delete]', 'disabled')) !== null, 'delete buttons disabled while running')
    ok('la guía se completa sola y desaparece; Inicio muestra la región y bloquea el cambio de idioma en marcha')
    await waitFor(async () => (await attr(window, '#installed li[data-model=t] [data-action=delete]', 'disabled')) !== null, 'delete buttons disabled while running')
    expect(await exists(window, '#delete-blocked'), 'se explica por qué no se puede borrar')
    const blocked = await evaluate<{ ok: boolean; reason?: string }>(window, `window.trSettings.deleteModel('t')`)
    expect(!blocked.ok && blocked.reason === 'running', `el borrado se rechaza con una sesión: ${JSON.stringify(blocked)}`)
    expect(existsSync(join(modelsDir, 't', 'b.bin')), 'los archivos siguen ahí')
    const dirBlocked = await evaluate<{ ok: boolean; errors?: string[] }>(window, `window.trSettings.updateSettings({ modelsDir: ${JSON.stringify(join(dir, 'otra'))} })`)
    expect(!dirBlocked.ok && settings.get().modelsDir === null, 'la carpeta no cambia durante una sesión')
    expect(await evaluate<boolean>(window, `document.getElementById('models-dir').disabled`), 'el campo de carpeta se desactiva')
    session.state = { running: false, paused: false, mode: null }
    session.emit('state', session.state)
    await waitFor(async () => (await attr(window, '#installed li[data-model=t] [data-action=delete]', 'disabled')) === null, 'delete buttons enabled again')
    ok('con una traducción en marcha no se borran modelos ni se cambia la carpeta')

    // Carpeta de modelos: validación en línea y cambio efectivo.
    const folder = mkdtempSync(join(tmpdir(), 'tr-settings-newdir-'))
    await setControl(window, '#models-dir', 'relativa/carpeta')
    await waitFor(async () => (await text(window, '#models-dir-error')).includes('ruta completa'), 'the relative path message')
    expect((await attr(window, '#models-dir', 'aria-invalid')) === 'true', 'el campo se marca como inválido')
    expect((await attr(window, '#models-dir', 'aria-describedby'))?.includes('models-dir-error') === true, 'el error está asociado al campo')
    expect(settings.get().modelsDir === null, 'una carpeta relativa no se guarda')
    await setControl(window, '#models-dir', file)
    await waitFor(async () => (await text(window, '#models-dir-error')).includes('archivo'), 'the not-a-folder message')
    await setControl(window, '#models-dir', '/')
    await waitFor(async () => (await text(window, '#models-dir-error')).includes('raíz'), 'the root message')
    await setControl(window, '#models-dir', join(folder, 'nuevos', 'modelos'))
    await waitFor(() => settings.get().modelsDir === join(folder, 'nuevos', 'modelos'), 'the folder to be saved')
    await waitFor(async () => (await text(window, '#effective-dir')) === join(folder, 'nuevos', 'modelos'), 'the effective folder to follow')
    await waitFor(() => exists(window, '#installed-empty'), 'the new folder to be empty')
    expect(readdirSync(folder).length === 0, 'validar y guardar no crea la carpeta hasta que hace falta')
    expect(existsSync(join(modelsDir, 'o', 'a.bin')), 'los modelos de la carpeta anterior no se tocan')
    // Elegir con el diálogo del sistema y volver a la predeterminada.
    const picked = mkdtempSync(join(tmpdir(), 'tr-settings-picked-'))
    files.folder = picked
    await click(window, '#pick-dir')
    await waitFor(() => settings.get().modelsDir === picked, 'the picked folder to be saved')
    await click(window, '#reset-dir')
    await waitFor(() => settings.get().modelsDir === null, 'the default folder to come back')
    await waitFor(async () => (await text(window, '#effective-dir')) === modelsDir, 'the default folder to be in use')
    await waitFor(async () => (await evaluate<number>(window, `document.querySelectorAll('#installed li[data-model]').length`)) === 3, 'the original models back in the list')
    ok('la carpeta de modelos se valida en línea, se cambia, se elige con el diálogo y vuelve a la predeterminada')

    // Cambios que se guardan y se aplican (la fuente de verdad es el almacén del proceso principal).
    await click(window, '#tab-appearance')
    await setControl(window, '#opacity', '0.5')
    await waitFor(() => settings.get().overlay.opacity === 0.5, 'opacity to be saved')
    await setControl(window, '#fontSize', '36')
    await waitFor(() => settings.get().overlay.fontSize === 36, 'font size to be saved')
    await setControl(window, '#showOriginal', false)
    await waitFor(() => !settings.get().overlay.showOriginal, 'showOriginal to be saved')
    await waitFor(async () => !(await exists(window, '#preview .original')), 'the preview to hide the original')
    expect((await evaluate<string>(window, `document.getElementById('preview').style.fontSize`)) === '36px', 'la vista previa refleja el tamaño')
    ok('los cambios se guardan y la vista previa los refleja')

    // Colores y contraste.
    expect((await text(window, '#contrast')).includes('legible'), 'el contraste por defecto es legible')
    await setControl(window, '#textColor', '#ffee00')
    await waitFor(() => settings.get().overlay.textColor === '#ffee00', 'the text colour to be saved')
    await waitFor(async () => (await evaluate<string>(window, `document.getElementById('preview').style.color`)) === 'rgb(255, 238, 0)', 'the preview to use the colour')
    await setControl(window, '#backgroundColor', '#ffffff')
    await waitFor(async () => (await text(window, '#textColor-error')).includes('contraste'), 'the contrast message')
    expect(settings.get().overlay.backgroundColor === '#0c0c10', 'un fondo sin contraste no se guarda')
    expect((await text(window, '#contrast')).includes('demasiado bajo'), 'el indicador de contraste avisa')
    expect((await attr(window, '#textColor', 'aria-invalid')) === 'true', 'el color de texto se marca como inválido')
    await setControl(window, '#textColor', '#000000')
    await waitFor(() => settings.get().overlay.backgroundColor === '#ffffff' && settings.get().overlay.textColor === '#000000', 'the valid pair to be saved')
    expect(!(await text(window, '#textColor-error')).includes('contraste'), 'el error desaparece al corregirlo')
    await setControl(window, '#maxLines', '1')
    await waitFor(() => settings.get().overlay.maxLines === 1, 'max lines to be saved')
    await setControl(window, '#maxLines', '9')
    await waitFor(async () => (await text(window, '#maxLines-error')).includes('entre 1 y 6'), 'the max lines message')
    expect(settings.get().overlay.maxLines === 1, 'un límite fuera de rango no se guarda')
    ok('colores con contraste mínimo validado y límite de líneas')

    // Posición manual.
    await setControl(window, '#placement-manual', true)
    await waitFor(() => settings.get().overlay.placement === 'manual', 'manual placement to be saved')
    expect(await evaluate<boolean>(window, `document.getElementById('position-coords').open === false`), 'X e Y están plegadas por defecto')
    expect(await evaluate<boolean>(window, `!!(document.getElementById('move-overlay').compareDocumentPosition(document.getElementById('placement-auto')) & Node.DOCUMENT_POSITION_FOLLOWING)`), 'el botón de mover va antes que las opciones de posición')
    expect(await evaluate<boolean>(window, `getComputedStyle(document.querySelector('.preview-sticky')).position === 'sticky'`), 'la vista previa queda fija')
    await setControl(window, '#overlay-x', '120')
    await waitFor(() => settings.get().overlay.x === 120, 'x to be saved')
    await setControl(window, '#placement-auto', true)
    await waitFor(() => settings.get().overlay.placement === 'auto', 'auto placement to be saved')
    ok('la posición automática o manual se guarda')

    // Mover el overlay desde Ajustes: se abre solo para eso, se arrastra y se cierra al terminar.
    expect(windows.get('overlay') === undefined, 'sin sesión no hay overlay abierto')
    await click(window, '#move-overlay')
    await waitFor(() => overlay.moving && windows.get('overlay') !== undefined, 'the overlay to enter move mode')
    await waitFor(async () => (await attr(window, '#move-overlay', 'aria-pressed')) === 'true', 'the button to show the pressed state')
    expect((await text(window, '#move-overlay')).includes('Terminar'), 'el botón ofrece terminar')
    await click(window, '#move-overlay')
    await waitFor(() => !overlay.moving && windows.get('overlay') === undefined, 'the overlay to close after moving')
    await waitFor(async () => (await attr(window, '#move-overlay', 'aria-pressed')) === 'false', 'the button to be released')
    ok('el botón "Mover el overlay" abre el overlay en modo mover y lo cierra al terminar')

    // Rendimiento.
    await click(window, '#tab-advanced')
    await setControl(window, '#perf-threads', '4')
    await waitFor(() => settings.get().performance.intraThreads === 4, 'threads to be saved')
    await setControl(window, '#perf-beam', '3')
    await waitFor(() => settings.get().performance.beamWidth === 3, 'beam to be saved')
    await setControl(window, '#perf-cache', '512')
    await waitFor(() => settings.get().performance.cacheCapacity === 512, 'cache to be saved')
    await setControl(window, '#perf-threads', '99')
    await waitFor(async () => (await text(window, '#perf-threads-error')).includes('64'), 'the threads message')
    expect(settings.get().performance.intraThreads === 4, 'un valor fuera de rango no se guarda')
    expect(models.options().performance?.intraThreads === 4 && models.options().performance?.cacheCapacity === 512, 'las opciones del motor llevan el rendimiento')
    await setControl(window, '#perf-threads', '0')
    await waitFor(() => settings.get().performance.intraThreads === 0, 'automatic threads to be saved')
    expect(models.options().performance?.intraThreads === undefined, 'automático no se envía al motor')
    ok('el rendimiento se valida, se guarda y llega a las opciones del motor')

    // Modo: automático por defecto (descargó también los de audio), espera del fallback y atajo.
    await click(window, '#tab-general')
    expect(settings.get().mode === 'auto', 'el modo por defecto es automático')
    await click(window, '#tab-models')
    expect(await exists(window, '#audio-models-ready'), 'en automático la descarga incluyó los modelos de audio')
    expect(!(await exists(window, '#audio-required')), 'con los modelos de audio listos no hay aviso')
    await click(window, '#tab-general')
    await setControl(window, '#fallbackSeconds', '10')
    await waitFor(() => settings.get().fallbackSeconds === 10, 'fallback seconds to be saved')
    await setControl(window, '#fallbackSeconds', '0')
    await waitFor(async () => (await text(window, '#errors')).includes('segundos'), 'the fallback range message')
    expect((await text(window, '#fallbackSeconds-error')).includes('segundos'), 'el mensaje también sale junto al campo')
    expect(settings.get().fallbackSeconds === 10, 'una espera fuera de rango no se guarda')
    await setControl(window, '#mode-audio', true)
    await waitFor(() => settings.get().mode === 'audio', 'audio mode to be saved')
    await waitFor(async () => !(await exists(window, '#fallbackSeconds')), 'the fallback field to hide outside auto mode')
    // Inicio refleja el modo: en solo audio no hay región que elegir.
    expect(await evaluate<boolean>(window, `document.querySelector('input[name=home-mode][value=audio]').checked`), 'Inicio marca el modo elegido en General')
    expect(!(await exists(window, '#choose-region')), 'en solo audio no se ofrece elegir región')
    expect((await text(window, '#region-text')).includes('no necesita región'), 'Inicio explica que el modo no necesita región')
    await setControl(window, 'input[name=home-mode][value=text]', true)
    await waitFor(() => settings.get().mode === 'text', 'the mode chosen from Inicio to be saved')
    await waitFor(async () => await evaluate<boolean>(window, `document.getElementById('mode-text').checked`), 'General to follow the mode chosen in Inicio')
    expect(await exists(window, '#choose-region'), 'en solo texto vuelve el botón de región')
    await setControl(window, '#mode-text', true)
    await waitFor(() => settings.get().mode === 'text', 'text mode to be saved')
    await setControl(window, '#mode-auto', true)
    await waitFor(async () => await exists(window, '#fallbackSeconds'), 'the fallback field to come back in auto mode')
    await click(window, '#tab-shortcuts')
    await setControl(window, '#shortcut-mode', 'Alt+M')
    await waitFor(() => settings.get().shortcuts.toggleMode === 'Alt+M', 'the mode shortcut to be saved')
    ok('modo, espera del fallback y atajo de modo se guardan, validan y se reflejan en la ventana')

    // Valores inválidos: se explican y no se guardan.
    await click(window, '#tab-appearance')
    await setControl(window, '#fontSize', '5')
    await waitFor(async () => (await text(window, '#errors')).length > 0, 'the validation message')
    expect(settings.get().overlay.fontSize === 36, 'un valor inválido no se guarda')
    expect((await text(window, '#fontSize-error')).includes('10 y 96'), 'el error sale junto al campo')
    await setControl(window, '#fontSize', '40')
    await waitFor(async () => (await text(window, '#errors')) === '', 'the error to clear after fixing it')
    ok('un valor inválido se explica junto al campo y no se guarda')

    // Los cambios hechos fuera de la ventana también se ven en ella.
    settings.update({ overlay: { fontSize: 50 } })
    await waitFor(async () => (await evaluate<string>(window, `document.getElementById('fontSize').value`)) === '50', 'the window to follow external changes')
    ok('la ventana sigue los cambios hechos desde fuera')

    // Exportar: solo preferencias, nunca región ni carpeta.
    settings.update({ lastRegion: { x: 1, y: 2, width: 300, height: 100, monitor: 0 }, modelsDir: join(dir, 'secreto') })
    const exported = join(dir, 'export.json')
    files.exportTo = exported
    await click(window, '#tab-advanced')
    await click(window, '#export-settings')
    await waitFor(() => existsSync(exported), 'the export file')
    const exportedText = readFileSync(exported, 'utf8')
    expect(!exportedText.includes('lastRegion') && !exportedText.includes('modelsDir') && !exportedText.includes('secreto'), 'lo exportado no incluye región ni carpeta')
    expect(JSON.parse(exportedText).settings.overlay.fontSize === 50, 'lo exportado lleva las preferencias')
    await waitFor(async () => (await text(window, '#status')).includes('exportadas'), 'the export announcement')
    // Importar: valores válidos se aplican conservando región y carpeta; inválidos se rechazan enteros.
    const incoming = JSON.parse(exportedText)
    incoming.settings.overlay.fontSize = 44
    const importPath = join(dir, 'import.json')
    writeFileSync(importPath, JSON.stringify(incoming))
    files.importFrom = importPath
    await click(window, '#import-settings')
    await waitFor(() => settings.get().overlay.fontSize === 44, 'the import to apply')
    expect(settings.get().lastRegion?.width === 300 && settings.get().modelsDir === join(dir, 'secreto'), 'la importación conserva región y carpeta del equipo')
    incoming.settings.overlay.opacity = 7
    incoming.settings.overlay.fontSize = 60
    writeFileSync(importPath, JSON.stringify(incoming))
    await click(window, '#import-settings')
    await waitFor(async () => (await text(window, '#errors')).includes('opacidad'), 'the import error')
    expect(settings.get().overlay.fontSize === 44, 'una importación inválida no cambia nada')
    writeFileSync(importPath, JSON.stringify({ format: 'translate-settings', version: 1, settings: { modelsDir: '/x' } }))
    await click(window, '#import-settings')
    await waitFor(async () => (await text(window, '#errors')).includes('no se importan'), 'the local data import error')
    expect(settings.get().modelsDir === join(dir, 'secreto'), 'no se importan carpetas')
    ok('exportar no incluye datos del equipo; importar es todo o nada')

    // Restablecer: con confirmación y conservando región y carpeta.
    await click(window, '#reset-settings')
    await waitFor(() => exists(window, '#confirm-reset'), 'the reset confirmation')
    await click(window, '#cancel-reset')
    expect(settings.get().overlay.fontSize === 44, 'cancelar no restablece')
    await waitFor(() => exists(window, '#reset-settings'), 'the reset button to come back')
    await click(window, '#reset-settings')
    await waitFor(() => exists(window, '#confirm-reset'), 'the reset confirmation again')
    await click(window, '#confirm-reset')
    await waitFor(() => settings.get().overlay.fontSize === defaultSettings().overlay.fontSize, 'the reset to apply')
    const after = settings.get()
    expect(after.mode === 'auto' && after.performance.beamWidth === 0 && after.shortcuts.toggleMode === defaultSettings().shortcuts.toggleMode, 'las preferencias vuelven a su valor por defecto')
    expect(after.lastRegion?.width === 300 && after.modelsDir === join(dir, 'secreto'), 'restablecer conserva región y carpeta')
    ok('restablecer pide confirmación y conserva región y carpeta')

    // Escucha previa del nivel: la barra se mueve en cuanto Inicio está a la vista, sin sesión, y cede ante una sesión.
    // Con motores de demostración (el audio suena a ráfagas y no abre ningún dispositivo del equipo).
    let levelEvents = 0
    host.on('event', (event) => {
      if (event.name === 'audioLevel') levelEvents += 1
    })
    /** Cuenta los niveles que llegan en una ventana de tiempo; cero = no hay ninguna captura midiendo. */
    const levelsDuring = async (ms: number): Promise<number> => {
      await sleep(400) // deja pasar lo que ya estuviera en vuelo
      const before = levelEvents
      await sleep(ms)
      return levelEvents - before
    }
    expect(settings.update({ engines: 'fake', mode: 'auto', audioSource: { kind: 'system' } }).ok, 'ajustes de la escucha previa')
    window.showInactive() // una ventana oculta cuenta como «fuera de vista»
    await click(window, '#tab-home')
    await waitFor(async () => (await text(window, '#monitor-note')).includes('Escuchando'), 'the preview note', 15_000)
    await waitFor(async () => Number((await attr(window, '#level-meter', 'aria-valuenow')) ?? 0) > 0, 'the meter to move without a session')
    ok('la barra se mueve en cuanto Inicio está a la vista, sin pulsar Iniciar')

    // Una sesión la sustituye: el motor cierra la escucha antes de abrir su captura y, al terminar, vuelve a medir.
    session.state = { running: true, paused: false, mode: null }
    session.emit('state', session.state)
    await waitFor(async () => (await text(window, '#monitor-note')) === '', 'the preview note to go away with a session')
    expect((await levelsDuring(600)) === 0, 'la escucha no sigue midiendo con una sesión en marcha')
    session.state = { running: false, paused: false, mode: null }
    session.emit('state', session.state)
    await waitFor(async () => (await text(window, '#monitor-note')).includes('Escuchando'), 'the preview to come back after the session')
    expect((await levelsDuring(600)) > 0, 'al terminar la sesión la escucha vuelve a medir')
    ok('con una sesión en marcha la escucha cede y al terminar vuelve a medir')

    // «Solo texto» no usa el audio: no se abre ninguna captura y la barra lo explica.
    expect(settings.update({ mode: 'text' }).ok, 'modo solo texto')
    await waitFor(async () => (await text(window, '#monitor-note')).includes('Solo texto'), 'the text-mode note')
    expect((await levelsDuring(600)) === 0, 'sin captura de audio en «Solo texto»')
    expect(settings.update({ mode: 'auto' }).ok, 'modo automático')
    await waitFor(async () => (await text(window, '#monitor-note')).includes('Escuchando'), 'the preview after the text mode')
    ok('en «Solo texto» no se escucha el audio y se explica')

    // Fuera de vista (otra pestaña o ventana oculta) no queda ninguna captura abierta.
    await click(window, '#tab-general')
    expect((await levelsDuring(600)) === 0, 'al salir de Inicio no queda ninguna captura abierta')
    await click(window, '#tab-home')
    await waitFor(() => levelEvents > 0 && text(window, '#monitor-note').then((t) => t.includes('Escuchando')), 'the preview to resume on return')
    expect((await levelsDuring(600)) > 0, 'al volver a Inicio se vuelve a medir')
    window.hide()
    expect((await levelsDuring(600)) === 0, 'con la ventana oculta tampoco queda ninguna captura abierta')
    ok('al salir de Inicio o ocultar la ventana la escucha se detiene y al volver se reanuda')

    expect(settings.update({ engines: 'real' }).ok, 'se restauran los motores reales')

    // Tema claro y oscuro del sistema.
    const background = () => evaluate<string>(window, `getComputedStyle(document.body).backgroundColor`)
    nativeTheme.themeSource = 'light'
    await waitFor(async () => (await background()) === 'rgb(255, 255, 255)', 'the light theme')
    nativeTheme.themeSource = 'dark'
    await waitFor(async () => (await background()) === 'rgb(23, 24, 28)', 'the dark theme')
    nativeTheme.themeSource = 'system'
    ok('la ventana sigue el tema claro u oscuro del sistema')

    dispose()
    windows.close('settings')
  } finally {
    fixture.server.close()
    fixture.server.closeAllConnections()
  }
}
