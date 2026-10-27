// Proceso utilitario: carga el módulo nativo y lo conecta con el proceso principal por mensajes.
// Aislado de main: un fallo fatal del motor solo termina este proceso.

import * as engine from 'tr-bindings'

import type { EngineEvent, Request, WorkerMessage } from '../shared/protocol'

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

function run(request: Request): void {
  switch (request.type) {
    case 'configure':
      engine.configure(request.options)
      return
    case 'startRegion':
      engine.startRegionTranslation(request.rect, request.from, request.to)
      return
    case 'startAudio':
      engine.startAudioSubtitles(request.from, request.to)
      return
    case 'stop':
      engine.stop()
      return
    default: {
      const unknown: never = request
      throw new Error(`unknown command: ${JSON.stringify(unknown)}`)
    }
  }
}

port.on('message', ({ data }) => {
  const request = data as Request
  try {
    run(request)
    send({ type: 'reply', id: request.id })
  } catch (error) {
    send({
      type: 'reply',
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

send({ type: 'ready' })
