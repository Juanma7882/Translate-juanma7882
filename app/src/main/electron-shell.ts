// Implementaciones reales (Electron) de lo que `AppShell` necesita del sistema.

import { join } from 'node:path'

import { app, dialog, globalShortcut, Menu, nativeImage, Notification, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { AppShell } from './app-shell.ts'
import type { TrayLike } from './app-shell.ts'
import type { EngineHost } from './engine-host.ts'
import type { FilePrompts } from './settings-ipc.ts'
import { electronDisplays } from './region-picker.ts'
import { SettingsStore } from './settings-store.ts'
import type { WindowManager } from './windows.ts'

/** Icono de la bandeja generado en memoria (círculo sólido): sin archivos de imagen que empaquetar. */
function trayIcon(size = 32) {
  const bitmap = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x - center, y - center) <= size / 2 - 2
      const offset = (y * size + x) * 4
      // BGRA
      bitmap[offset] = 0xd2
      bitmap[offset + 1] = 0x7a
      bitmap[offset + 2] = 0x2b
      bitmap[offset + 3] = inside ? 0xff : 0x00
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size })
}

class ElectronTray implements TrayLike {
  private readonly tray = new Tray(trayIcon())

  update(template: MenuItemConstructorOptions[], tooltip: string): void {
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
    this.tray.setToolTip(tooltip)
  }

  destroy(): void {
    this.tray.destroy()
  }
}

/** Diálogos nativos, ancla en la ventana de Ajustes si está abierta. */
function nativeFiles(windows: WindowManager): FilePrompts {
  const parent = () => windows.get('settings')
  const filters = [{ name: 'Preferencias (JSON)', extensions: ['json'] }]
  const pick = async (options: Electron.OpenDialogOptions): Promise<string | null> => {
    const window = parent()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
  return {
    pickFolder: () => pick({ title: 'Carpeta de modelos', properties: ['openDirectory', 'createDirectory'] }),
    chooseImportPath: () => pick({ title: 'Importar preferencias', properties: ['openFile'], filters }),
    async chooseExportPath() {
      const options = { title: 'Exportar preferencias', defaultPath: 'traductor-preferencias.json', filters }
      const window = parent()
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      return result.canceled ? null : (result.filePath ?? null)
    },
  }
}

export function createAppShell(host: EngineHost, windows: WindowManager): AppShell {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  const { warnings } = settings.load()
  if (warnings.length > 0) console.warn(`[settings] ${warnings.join('; ')}`)

  return new AppShell({
    host,
    windows,
    settings,
    displays: electronDisplays(),
    tray: new ElectronTray(),
    shortcuts: globalShortcut,
    notify: (notice) => {
      if (Notification.isSupported()) new Notification({ title: 'Traductor', body: notice.message, silent: notice.level === 'info' }).show()
    },
    quit: () => app.quit(),
    files: nativeFiles(windows),
  })
}
