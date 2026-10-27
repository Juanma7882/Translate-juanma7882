// Prueba de humo del flujo completo JS -> Rust -> JS y de la supervisión del proceso del motor.
// Se activa con TR_SMOKE=1. Solo imprime metadatos (nunca el contenido traducido).

import type { EngineEvent, EngineEventName } from '../shared/protocol'
import type { CrashInfo, EngineHost } from './engine-host'

const STEP_TIMEOUT_MS = 15_000
const REGION = { x: 0, y: 0, width: 64, height: 64 }

function once<T>(
  register: (listener: (value: T) => void) => void,
  unregister: (listener: (value: T) => void) => void,
  accept: (value: T) => boolean,
  what: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unregister(listener)
      reject(new Error(`timed out waiting for ${what}`))
    }, STEP_TIMEOUT_MS)
    const listener = (value: T): void => {
      if (!accept(value)) return
      clearTimeout(timer)
      unregister(listener)
      resolve(value)
    }
    register(listener)
  })
}

function waitForEvent(host: EngineHost, name: EngineEventName): Promise<EngineEvent> {
  return once<EngineEvent>(
    (l) => host.on('event', l),
    (l) => host.off('event', l),
    (event) => event.name === name,
    `a "${name}" event`,
  )
}

function waitForCrash(host: EngineHost): Promise<CrashInfo> {
  return once<CrashInfo>(
    (l) => host.on('crashed', l),
    (l) => host.off('crashed', l),
    () => true,
    'the engine process to exit',
  )
}

function ok(step: string): void {
  console.log(`[smoke] ok: ${step}`)
}

async function startRegion(host: EngineHost): Promise<void> {
  await host.send({ type: 'configure', options: { frameIntervalMs: 5 } })
  const translation = waitForEvent(host, 'translation')
  await host.send({ type: 'startRegion', rect: REGION, from: 'en', to: 'es' })
  const event = await translation
  if (event.name !== 'translation' || event.payload.translated.length === 0) {
    throw new Error('malformed translation event')
  }
}

export async function runSmoke(host: EngineHost): Promise<void> {
  const mainPid = process.pid

  host.start()
  await host.whenReady()
  ok('engine process started and ready')

  // 1. Flujo completo: main -> utility -> Rust -> utility -> main.
  await startRegion(host)
  ok('translation event reached the main process')

  // Argumentos inválidos: el error vuelve como rechazo, el motor sigue vivo.
  await host
    .send({ type: 'startRegion', rect: { ...REGION, width: 0 }, from: 'en', to: 'es' })
    .then(
      () => {
        throw new Error('an invalid region should be rejected')
      },
      () => undefined,
    )
  ok('invalid arguments are rejected without killing the engine')

  // 2. Caída del proceso del motor: main sigue vivo, avisa y reinicia con espera creciente.
  const firstPid = host.pid
  const crash1 = waitForCrash(host)
  host.kill()
  const first = await crash1
  await host.whenReady()
  if (host.pid === firstPid) throw new Error('a new engine process should have been spawned')
  ok(`engine restarted after a crash (waited ${first.restartInMs} ms)`)

  const crash2 = waitForCrash(host)
  host.kill()
  const second = await crash2
  if (second.restartInMs <= first.restartInMs) {
    throw new Error('the restart delay should grow after consecutive crashes')
  }
  await host.whenReady()
  ok(`backoff grows after consecutive crashes (${first.restartInMs} -> ${second.restartInMs} ms)`)

  if (process.pid !== mainPid) throw new Error('main process changed')

  // 3. Tras reiniciar, el motor vuelve a funcionar.
  await startRegion(host)
  ok('engine works again after the restart')

  // 4. Parada ordenada.
  await host.send({ type: 'stop' })
  host.shutdown()
  ok('clean shutdown')
}
