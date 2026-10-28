// IPC de la ventana principal (pestaña Inicio): controles de sesión, lista de fuentes de audio y nivel.
//
// No importa `electron` en tiempo de ejecución: recibe el registro de canales ya protegido por el guardián de
// remitente (ver `guardedHandle`), así se prueba sin Electron. Solo viajan órdenes, nombres, números y estado.

import type { AppState, AudioSourcesInfo } from '../shared/ipc.ts'
import { Channel } from '../shared/ipc.ts'
import type { EngineEvent } from '../shared/protocol.ts'

/** Lo mínimo de `ipcMain` que se usa. */
export interface IpcRegistry {
  handle(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
}

/**
 * Registra canales que solo atienden al remitente permitido (la ventana de Ajustes/Inicio). `allowed()` devuelve
 * el remitente válido en este momento, o `null` si la ventana no existe.
 */
export function guardedHandle(ipc: IpcRegistry, allowed: () => unknown): <A extends unknown[], R>(channel: string, run: (...args: A) => R | Promise<R>) => void {
  return (channel, run) => {
    ipc.handle(channel, (event, ...args) => {
      const sender = allowed()
      if (sender === null || sender === undefined || event.sender !== sender) throw new Error('unauthorized sender')
      return run(...(args as Parameters<typeof run>))
    })
  }
}

export interface SessionControls {
  state: AppState
  startSession(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  restart(): Promise<void>
  stop(): Promise<void>
  chooseRegion(): Promise<boolean>
  pickRegion(): Promise<boolean>
  pickOverlayPosition(): Promise<boolean>
  showRegion(): Promise<boolean>
}

export interface SessionEngine {
  send(command: { type: 'listAudioSources' } | { type: 'voiceThreshold' }): Promise<unknown>
  on(event: 'event', listener: (event: EngineEvent) => void): unknown
  off(event: 'event', listener: (event: EngineEvent) => void): unknown
}

export const SESSION_CHANNELS = [
  Channel.sessionStart,
  Channel.sessionPause,
  Channel.sessionResume,
  Channel.sessionRestart,
  Channel.sessionStop,
  Channel.sessionChooseRegion,
  Channel.sessionPickRegion,
  Channel.sessionPickOverlayPosition,
  Channel.sessionShowRegion,
  Channel.sessionState,
  Channel.audioSources,
  Channel.audioVoiceThreshold,
] as const

export interface SessionIpcDeps {
  handle: ReturnType<typeof guardedHandle>
  controller: SessionControls
  host: SessionEngine
  toWindow(channel: string, payload: unknown): void
}

/** Registra los canales de sesión y devuelve una función que los retira (con `removeHandler` en `ipc`). */
export function registerSessionIpc({ handle, controller, host, toWindow }: SessionIpcDeps): () => void {
  handle(Channel.sessionStart, () => controller.startSession())
  handle(Channel.sessionPause, () => controller.pause())
  handle(Channel.sessionResume, () => controller.resume())
  handle(Channel.sessionRestart, () => controller.restart())
  handle(Channel.sessionStop, () => controller.stop())
  handle(Channel.sessionChooseRegion, () => controller.chooseRegion())
  handle(Channel.sessionPickRegion, () => controller.pickRegion())
  handle(Channel.sessionPickOverlayPosition, () => controller.pickOverlayPosition())
  handle(Channel.sessionShowRegion, () => controller.showRegion())
  handle(Channel.sessionState, () => controller.state)
  handle(Channel.audioSources, async (): Promise<AudioSourcesInfo> => {
    try {
      return (await host.send({ type: 'listAudioSources' })) as AudioSourcesInfo
    } catch {
      // El motor no está listo o no contesta: la lista queda vacía en vez de romper la ventana.
      return { supported: true, apps: [] }
    }
  })
  handle(Channel.audioVoiceThreshold, async (): Promise<number> => (await host.send({ type: 'voiceThreshold' })) as number)

  // `EngineHost` ya agrupa los niveles a 15 Hz como máximo.
  const onEvent = (event: EngineEvent): void => {
    if (event.name === 'audioLevel') toWindow(Channel.audioLevel, event.payload)
  }
  host.on('event', onEvent)
  return () => host.off('event', onEvent)
}
