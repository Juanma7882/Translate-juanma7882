// De los ajustes del usuario a las opciones del motor.

import type { EngineOptions } from 'tr-bindings'

import type { Settings } from '../shared/settings.ts'

/** Milisegundos entre capturas de pantalla en uso normal. */
export const FRAME_INTERVAL_MS = 200

export function engineOptionsFrom(settings: Settings): EngineOptions {
  const options: EngineOptions = { engines: settings.engines, frameIntervalMs: FRAME_INTERVAL_MS }
  if (settings.modelsDir) options.modelsDir = settings.modelsDir
  // Solo el modo automático usa el fallback; "solo texto" y "solo audio" no lo activan.
  if (settings.mode === 'auto') {
    options.autoFallback = true
    options.fallbackNoTextMs = settings.fallbackSeconds * 1000
  }
  return options
}
