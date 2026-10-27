// Gestor de ventanas de producto: selector de región, overlay y ajustes.
//
// Todas se crean con el mismo endurecimiento: contexto aislado, sandbox, sin integración de Node,
// sin navegación ni ventanas nuevas, y un preload mínimo propio. Solo existe una instancia de cada
// tipo a la vez.

import { join } from 'node:path'

import { BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions, Display } from 'electron'

export type WindowKind = 'selector' | 'overlay' | 'settings'

export interface OpenOptions {
  /** `false` crea la ventana sin mostrarla (pruebas). Por defecto se muestra al cargar. */
  show?: boolean
}

export class WindowManager {
  private readonly bundleDir: string
  private readonly windows = new Map<WindowKind, BrowserWindow>()

  /** `bundleDir` es la carpeta del bundle de main (`out/main`): de ahí cuelgan `../preload` y `../renderer`. */
  constructor(bundleDir: string) {
    this.bundleDir = bundleDir
  }

  get(kind: WindowKind): BrowserWindow | undefined {
    const window = this.windows.get(kind)
    return window && !window.isDestroyed() ? window : undefined
  }

  get openCount(): number {
    return [...this.windows.values()].filter((w) => !w.isDestroyed()).length
  }

  /** Selector de región: sin marco, transparente y a pantalla completa sobre `display`. */
  openSelector(display: Display, options: OpenOptions = {}): Promise<BrowserWindow> {
    const { x, y, width, height } = display.bounds
    return this.open(
      'selector',
      { x, y, width, height, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false, hasShadow: false },
      options,
    )
  }

  /** Overlay de traducción: transparente, encima y sin foco (los detalles finos llegan en la 9.2). */
  openOverlay(options: OpenOptions = {}): Promise<BrowserWindow> {
    return this.open(
      'overlay',
      { width: 900, height: 160, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, hasShadow: false },
      options,
    )
  }

  openSettings(options: OpenOptions = {}): Promise<BrowserWindow> {
    return this.open('settings', { width: 760, height: 700, minWidth: 560, minHeight: 480, title: 'Ajustes · Traductor' }, options)
  }

  close(kind: WindowKind): void {
    this.get(kind)?.destroy()
    this.windows.delete(kind)
  }

  closeAll(): void {
    for (const kind of [...this.windows.keys()]) this.close(kind)
  }

  private async open(kind: WindowKind, window: BrowserWindowConstructorOptions, options: OpenOptions): Promise<BrowserWindow> {
    const existing = this.get(kind)
    if (existing) {
      if (options.show !== false) existing.show()
      return existing
    }

    const created = new BrowserWindow({
      ...window,
      show: false,
      webPreferences: {
        preload: join(this.bundleDir, '..', 'preload', `${kind}.js`),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    })
    this.windows.set(kind, created)
    created.on('closed', () => {
      if (this.windows.get(kind) === created) this.windows.delete(kind)
    })
    // El contenido es solo la interfaz de la aplicación: nada de navegar a otro sitio ni abrir ventanas.
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (event) => event.preventDefault())

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) await created.loadURL(`${devUrl}/${kind}/index.html`)
    else await created.loadFile(join(this.bundleDir, '..', 'renderer', kind, 'index.html'))

    if (options.show !== false) created.show()
    return created
  }
}
