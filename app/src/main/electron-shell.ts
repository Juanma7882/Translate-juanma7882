// Implementaciones reales (Electron) de lo que `AppShell` necesita del sistema.

import { join } from 'node:path'

import { app, globalShortcut, Menu, nativeImage, Notification, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { AppShell } from './app-shell.ts'
import type { TrayLike } from './app-shell.ts'
import type { EngineHost } from './engine-host.ts'
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
  })
}
