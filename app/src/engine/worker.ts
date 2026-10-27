// Proceso utilitario: carga el módulo nativo y lo conecta con el proceso principal por mensajes.
// Aislado de main: un fallo fatal del motor solo termina este proceso.

import { existsSync } from 'node:fs'

import type * as Engine from 'tr-bindings'

import type { EngineEvent, Request, WorkerMessage } from '../shared/protocol.ts'
import { resolveNativeEntry } from './native-path.ts'

// Empaquetada, la app lleva el módulo nativo en `resources/native` (fuera del asar); en desarrollo
// se usa el paquete `tr-bindings` enlazado. Ver native-path.ts.
const nativeEntry = resolveNativeEntry({
  env: process.env,
  resourcesPath: process.resourcesPath,
  exists: existsSync,
})
const engine: typeof Engine = nativeEntry ? require(nativeEntry) : require('tr-bindings')

const port = process.parentPort

function send(message: WorkerMessage): void {
  port.postMessage(message)
}

function forward<E extends EngineEvent>(name: E['name']) {
  return (payload: E['payload']): void => send({ type: 'event', name, payload } as WorkerMessage)
}

engine.onTranslation(forward<Extract<EngineEvent, { name: 'translation' }>>('translation'))
engine.onSubtitle(forward<Extract<EngineEvent, { name: 'subtitle' }>>('subtitle'))
engine.onError(forward<Extract<EngineEvent, { name: 'error' }>>('error'))
engine.onModelProgress(forward<Extract<EngineEvent, { name: 'modelProgress' }>>('modelProgress'))
engine.onModeChanged(forward<Extract<EngineEvent, { name: 'mode' }>>('mode'))

async function run(request: Request): Promise<unknown> {
  switch (request.type) {
    case 'configure':
      engine.configure(request.options)
      return undefined
    case 'startRegion':
      engine.startRegionTranslation(request.rect, request.from, request.to)
      return undefined
    case 'startAudio':
      engine.startAudioSubtitles(request.from, request.to)
      return undefined
    case 'stop':
      engine.stop()
      return undefined
    case 'pause':
      engine.pause()
      return undefined
    case 'resume':
      engine.resume()
      return undefined
    case 'modelCatalog':
      return engine.modelCatalog()
    case 'modelStatus':
      return engine.modelStatus(request.from, request.to)
    case 'downloadModels':
      return engine.downloadModels(request.from, request.to)
    default: {
      const unknown: never = request
      throw new Error(`unknown command: ${JSON.stringify(unknown)}`)
    }
  }
}

port.on('message', ({ data }) => {
  const request = data as Request
  run(request).then(
    (value) => send({ type: 'reply', id: request.id, value }),
    (error: unknown) =>
      send({ type: 'reply', id: request.id, error: error instanceof Error ? error.message : String(error) }),
  )
})

send({ type: 'ready' })
