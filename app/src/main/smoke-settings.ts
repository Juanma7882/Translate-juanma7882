// Prueba de humo de la ventana de Ajustes (TR_SMOKE=settings): la interfaz real (Preact) sobre el
// motor real, con descargas contra un servidor HTTP local y un manifiesto propio (sin internet).
// Cubre idiomas según el catálogo, accesibilidad básica, cambios que se guardan y se aplican en vivo,
// validación, y la gestión de modelos: avance, error con reintento y estado final "listo".

import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BrowserWindow } from 'electron'

import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import { ModelsService } from './models-service.ts'
import { RegionPicker } from './region-picker.ts'
import type { DisplaySource } from './region-picker.ts'
import { registerSettingsIpc } from './settings-ipc.ts'
import { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

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
}

export interface Fixture {
  server: Server
  manifestPath: string
  /** Mientras sea `true`, el servidor responde 500 a todo. */
  failing: { value: boolean }
}

/** Servidor local con un manifiesto de modelos de juguete, para ejercitar descargas sin internet. */
export async function startFixture(): Promise<Fixture> {
  const failing = { value: false }
  const server = createServer((req, res) => {
    const name = (req.url ?? '').slice(1)
    const body = FILES[name]
    if (!body || failing.value) {
      res.writeHead(body ? 500 : 404).end()
      return
    }
    res.writeHead(200, { 'content-length': body.length })
    let offset = 0
    const pump = (): void => {
      if (offset >= body.length) {
        res.end()
        return
      }
      res.write(body.subarray(offset, offset + 10_000))
      offset += 10_000
      setTimeout(pump, 30)
    }
    pump()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const entry = (name: string) => `{"name":"${name}","url":"http://127.0.0.1:${port}/${name}","sha256":"${sha256(FILES[name]!)}","size":${FILES[name]!.length}}`
  const json = `{"version":1,"models":{"o":{"files":[${entry('a.bin')}]},"t":{"files":[${entry('b.bin')},${entry('c.bin')}]}},"ocr":{"en":"o"},"translate":{"en-es":"t"}}`
  const manifestPath = join(mkdtempSync(join(tmpdir(), 'tr-settings-manifest-')), 'models.json')
  writeFileSync(manifestPath, json)
  return { server, manifestPath, failing }
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

const text = (window: BrowserWindow, selector: string) => evaluate<string>(window, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)
const exists = (window: BrowserWindow, selector: string) => evaluate<boolean>(window, `document.querySelector(${JSON.stringify(selector)}) !== null`)

export async function runSettingsSmoke(host: EngineHost, windows: WindowManager, displays: DisplaySource): Promise<void> {
  const fixture = await startFixture()
  try {
    const file = join(mkdtempSync(join(tmpdir(), 'tr-settings-')), 'settings.json')
    const settings = new SettingsStore(file)
    settings.load()
    expect(settings.update({ engines: 'real', from: 'en', to: 'es' }).ok, 'ajustes iniciales')

    const modelsDir = mkdtempSync(join(tmpdir(), 'tr-settings-models-'))
    let controller: AppController
    const models = new ModelsService(host, settings, () => controller.state.running, () => ({ modelsDir, manifestPath: fixture.manifestPath }))
    controller = new AppController({ host, windows, settings, picker: new RegionPicker(windows, displays, () => settings.get().lastRegion), configure: () => models.configure() })
    host.start()
    await host.whenReady()
    const dispose = registerSettingsIpc({ windows, settings, models, host, controller })

    const window = await windows.openSettings({ show: false })
    await waitFor(() => exists(window, '#models li'), 'the model list')

    // Los idiomas ofrecidos salen del catálogo del motor (solo en -> es en este manifiesto).
    const fromOptions = await evaluate<string[]>(window, `[...document.querySelectorAll('#from option')].map(o => o.value)`)
    const toOptions = await evaluate<string[]>(window, `[...document.querySelectorAll('#to option')].map(o => o.value)`)
    expect(JSON.stringify(fromOptions) === '["en"]' && JSON.stringify(toOptions) === '["es"]', `idiomas del catálogo: ${fromOptions} -> ${toOptions}`)
    ok('los idiomas ofrecidos salen del catálogo de modelos')

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
    ok('controles con etiqueta, grupos con leyenda y orden de tabulación natural')

    // Modelos faltantes: se ofrece descargar, con el tamaño total.
    expect(await exists(window, '#download'), 'hay botón de descarga')
    expect(!(await exists(window, '#models-ready')), 'aún no están listos')
    expect((await text(window, '#models')).includes('falta'), 'los modelos figuran como faltantes')

    // Descarga con error: se muestra, y se puede reintentar.
    fixture.failing.value = true
    await evaluate(window, `document.getElementById('download').click()`)
    await waitFor(async () => (await exists(window, '#models [role=alert]')), 'the download error')
    expect(await evaluate<boolean>(window, `document.getElementById('download').textContent.includes('Reintentar')`), 'el botón pasa a "Reintentar"')
    expect(!(await exists(window, '#models-ready')), 'con error no figura como listo')
    ok('un fallo de descarga se muestra y ofrece reintentar')

    // Reintento: el avance sube sin retroceder hasta que todo queda listo.
    fixture.failing.value = false
    const samples: number[] = []
    await evaluate(window, `document.getElementById('download').click()`)
    await waitFor(async () => {
      const value = await evaluate<number | null>(window, `document.getElementById('download-progress')?.value ?? null`)
      if (value !== null) samples.push(value)
      return await exists(window, '#models-ready')
    }, 'the models to be ready', 20_000)
    expect(samples.length > 0 && samples.every((v, i) => i === 0 || v >= samples[i - 1]!), `el avance no retrocede: ${samples}`)
    expect(Math.max(...samples) > 0, `el avance se movió: ${samples}`)
    expect(!(await exists(window, '#download')), 'ya no se ofrece descargar')
    ok('la descarga avanza sin retroceder y termina en "listo"')

    // Cambios que se guardan y se aplican (la fuente de verdad es el almacén del proceso principal).
    await setControl(window, '#opacity', '0.5')
    await waitFor(() => settings.get().overlay.opacity === 0.5, 'opacity to be saved')
    await setControl(window, '#fontSize', '36')
    await waitFor(() => settings.get().overlay.fontSize === 36, 'font size to be saved')
    await setControl(window, '#showOriginal', false)
    await waitFor(() => !settings.get().overlay.showOriginal, 'showOriginal to be saved')
    await waitFor(async () => !(await exists(window, '#preview .original')), 'the preview to hide the original')
    expect((await evaluate<string>(window, `document.getElementById('preview').style.fontSize`)) === '36px', 'la vista previa refleja el tamaño')
    ok('los cambios se guardan y la vista previa los refleja')

    // Valores inválidos: se explican y no se guardan.
    await setControl(window, '#fontSize', '5')
    await waitFor(async () => (await text(window, '#errors')).length > 0, 'the validation message')
    expect(settings.get().overlay.fontSize === 36, 'un valor inválido no se guarda')
    ok('un valor inválido se explica y no se guarda')

    // Los cambios hechos fuera de la ventana también se ven en ella.
    settings.update({ overlay: { fontSize: 50 } })
    await waitFor(async () => (await evaluate<string>(window, `document.getElementById('fontSize').value`)) === '50', 'the window to follow external changes')
    ok('la ventana sigue los cambios hechos desde fuera')

    dispose()
    windows.close('settings')
  } finally {
    fixture.server.close()
    fixture.server.closeAllConnections()
  }
}
