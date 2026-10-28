// Reparto de las órdenes del protocolo hacia el módulo nativo. Separado del worker (que necesita
// `process.parentPort`) para probarlo con un motor simulado.

import type * as Engine from 'tr-bindings'

import type { AudioLevel, AudioSourcesInfo } from '../shared/ipc.ts'
import type { AudioSourceRequest, Request } from '../shared/protocol.ts'

// Funciones de audio por fuente del módulo nativo (contrato de los bindings). Mientras `index.d.ts` no las
// declare se tipan aquí; si un módulo antiguo no las trae, se degrada sin fallar.
// TODO: quitar este tipo cuando `tr-bindings` exporte los símbolos.
interface NativeAudioExtras {
  startAudioSubtitles(from: string, to: string, source?: AudioSourceRequest): void
  listAudioSources?: () => AudioSourcesInfo
  onAudioLevel?: (callback: (level: AudioLevel) => void) => void
  audioVoiceThreshold?: () => number
  /** Escucha previa del nivel; `false` si hay una sesión en marcha. */
  startAudioMonitor?: (source?: AudioSourceRequest) => boolean
  stopAudioMonitor?: () => void
}
export type NativeEngine = Omit<typeof Engine, 'startAudioSubtitles' | 'startAudioMonitor' | 'stopAudioMonitor'> & NativeAudioExtras

export async function runCommand(engine: NativeEngine, request: Request): Promise<unknown> {
  switch (request.type) {
    case 'configure':
      engine.configure(request.options)
      return undefined
    case 'startRegion':
      engine.startRegionTranslation(request.rect, request.from, request.to)
      return undefined
    case 'startAudio':
      engine.startAudioSubtitles(request.from, request.to, request.source)
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
      return engine.modelStatus(request.from, request.to, request.scope)
    case 'downloadModels':
      return engine.downloadModels(request.from, request.to, request.scope)
    case 'modelInventory':
      return engine.modelInventory()
    case 'deleteModel':
      return engine.deleteModel(request.modelId)
    case 'cancelDownload':
      await engine.cancelModelDownload()
      return undefined
    case 'validateModelsDir':
      return engine.validateModelsDir(request.path)
    case 'listAudioSources':
      return engine.listAudioSources ? engine.listAudioSources() : { supported: false, reason: 'the engine has no per-application audio' }
    case 'voiceThreshold':
      if (!engine.audioVoiceThreshold) throw new Error('the engine does not expose the voice threshold')
      return engine.audioVoiceThreshold()
    case 'startAudioMonitor':
      if (!engine.startAudioMonitor) throw new Error('the engine cannot preview the audio level')
      return engine.startAudioMonitor(request.source)
    case 'stopAudioMonitor':
      engine.stopAudioMonitor?.()
      return undefined
    default: {
      const unknown: never = request
      throw new Error(`unknown command: ${JSON.stringify(unknown)}`)
    }
  }
}

