// Avisos para el usuario a partir de errores del motor.
//
// Un aviso describe qué pasó y qué hacer; nunca incluye texto capturado ni traducido. Los mensajes
// del motor no contienen contenido (el núcleo lo garantiza), y aquí solo se añade contexto.

import type { Notice } from '../shared/ipc.ts'

const LABELS: Record<string, string> = {
  capture: 'No se pudo capturar la pantalla',
  ocr: 'No se pudo reconocer el texto',
  translation: 'No se pudo traducir',
  stt: 'No se pudo transcribir el audio',
  model: 'Hay un problema con los modelos',
  'invalid-argument': 'Ajuste no válido',
}

/** Aviso para un evento de error del motor. */
export function noticeForEngineError(category: string, message: string): Notice {
  const label = LABELS[category] ?? 'Error del motor'
  const notice: Notice = { level: 'error', message: `${label}: ${message}` }
  if (category === 'model' && /missing models/.test(message)) notice.code = 'models-missing'
  return notice
}

/** Aviso para un fallo al iniciar la traducción (la orden `startRegion` se rechazó). */
export function noticeForStartFailure(message: string): Notice {
  const notice: Notice = { level: 'error', message: `No se pudo iniciar la traducción: ${message}` }
  if (/missing models/.test(message)) notice.code = 'models-missing'
  return notice
}

export function noticeForCrash(restartInMs: number): Notice {
  return { level: 'warning', message: `El motor se detuvo inesperadamente; se reinicia en ${(restartInMs / 1000).toFixed(1)} s` }
}
