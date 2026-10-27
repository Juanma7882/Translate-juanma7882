import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

import type { SavedRegion } from '../shared/settings.ts'
import { createAppShell } from './electron-shell.ts'
import { EngineHost } from './engine-host.ts'
import { electronDisplays, RegionPicker } from './region-picker.ts'
import { runSmoke } from './smoke.ts'
import { SettingsStore } from './settings-store.ts'
import { runOverlaySmoke } from './smoke-overlay.ts'
import { runFlowSmoke } from './smoke-flow.ts'
import { runE2eSmoke } from './smoke-e2e.ts'
import { runSelectorSmoke } from './smoke-selector.ts'
import { runShellSmoke } from './smoke-shell.ts'
import { runSettingsSmoke } from './smoke-settings.ts'
import { runWindowsSmoke } from './smoke-windows.ts'
import { WindowManager } from './windows.ts'

const host = new EngineHost({ workerPath: join(__dirname, 'engine.js') })
const windows = new WindowManager(__dirname)

host.on('crashed', ({ exitCode, restartInMs }) => {
  // Solo metadatos: nunca contenido.
  console.error(`[engine] process exited unexpectedly (code ${exitCode}); restarting in ${restartInMs} ms`)
})

app.on('before-quit', () => host.shutdown())

/** Ejecuta una prueba de humo y sale con 0 (pasa) o 1 (falla). */
async function smoke(name: string, run: () => Promise<void>, timeoutMs = 60_000): Promise<void> {
  const timeout = setTimeout(() => {
    console.error(`[smoke] failed: global timeout (${name})`)
    app.exit(1)
  }, timeoutMs)
  try {
    await run()
    clearTimeout(timeout)
    console.log(`[smoke] passed (${name})`)
    host.shutdown() // `app.exit` no emite `before-quit`: sin esto se vería una "caída" falsa del motor
    app.exit(0)
  } catch (error) {
    console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
    host.shutdown()
    app.exit(1)
  }
}

void app.whenReady().then(async () => {
  switch (process.env['TR_SMOKE']) {
    case '1':
      return smoke('engine', () => runSmoke(host))
    case 'windows':
      return smoke('windows', () => runWindowsSmoke(windows))
    case 'selector': {
      const last: { value: SavedRegion | null } = { value: null }
      const displays = electronDisplays()
      const picker = new RegionPicker(windows, displays, () => last.value)
      return smoke('selector', () => runSelectorSmoke(windows, picker, displays, last))
    }
    case 'flow':
      return smoke('flow', () => runFlowSmoke(host, windows, electronDisplays()))
    case 'settings':
      return smoke('settings', () => runSettingsSmoke(host, windows, electronDisplays()))
    case 'overlay': {
      const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'tr-overlay-')), 'settings.json'))
      settings.load()
      return smoke('overlay', () => runOverlaySmoke(windows, settings, electronDisplays()))
    }
    case 'e2e':
      return smoke('e2e', () => runE2eSmoke(host, windows, electronDisplays()), 240_000)
    case 'shell':
      return smoke('shell', () => runShellSmoke(host, windows, electronDisplays()))
    default: {
      const shell = createAppShell(host, windows)
      app.on('before-quit', () => shell.dispose())
      shell.start()
    }
  }
})

// La aplicación sigue viva sin ventanas (bandeja, atajos): no se cierra al cerrar la última.
app.on('window-all-closed', () => {})
