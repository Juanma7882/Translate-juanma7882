import { join } from 'node:path'

import { app } from 'electron'

import { EngineHost } from './engine-host'
import { runSmoke } from './smoke'

const host = new EngineHost({ workerPath: join(__dirname, 'engine.js') })

host.on('crashed', ({ exitCode, restartInMs }) => {
  // Solo metadatos: nunca contenido.
  console.error(`[engine] process exited unexpectedly (code ${exitCode}); restarting in ${restartInMs} ms`)
})

app.on('before-quit', () => host.shutdown())

void app.whenReady().then(async () => {
  if (process.env.TR_SMOKE === '1') {
    const timeout = setTimeout(() => {
      console.error('[smoke] failed: global timeout')
      app.exit(1)
    }, 60_000)
    try {
      await runSmoke(host)
      clearTimeout(timeout)
      console.log('[smoke] passed')
      app.exit(0)
    } catch (error) {
      console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
      app.exit(1)
    }
    return
  }
  host.start()
})
