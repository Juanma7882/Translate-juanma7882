// Une el controlador de la sesión con el escritor de la transcripción: una sesión empieza cuando el
// estado pasa a `running` y termina cuando deja de estarlo (detener, caída del motor). Pausar no la
// termina: tras reanudar se sigue en los mismos archivos. Un reinicio por cambio de ajustes tampoco.

import type { AppState, OverlayText } from '../shared/ipc.ts'

export interface TranscriptSink {
  sessionStarted(): void
  sessionEnded(): Promise<void>
  line(text: OverlayText): void
}

/** Lo que hace falta del controlador: su estado y los eventos `state` y `text`. */
export interface SessionSource {
  readonly state: AppState
  on(event: 'state', listener: (state: AppState) => void): unknown
  on(event: 'text', listener: (text: OverlayText) => void): unknown
  off(event: 'state', listener: (state: AppState) => void): unknown
  off(event: 'text', listener: (text: OverlayText) => void): unknown
}

/** Conecta los eventos y devuelve una función que los desconecta. */
export function bindTranscript(controller: SessionSource, sink: TranscriptSink): () => void {
  let running = controller.state.running
  if (running) sink.sessionStarted()
  const onState = (state: AppState): void => {
    if (state.running === running) return
    running = state.running
    if (running) sink.sessionStarted()
    else void sink.sessionEnded()
  }
  const onText = (text: OverlayText): void => sink.line(text)
  controller.on('state', onState)
  controller.on('text', onText)
  return () => {
    controller.off('state', onState)
    controller.off('text', onText)
  }
}
