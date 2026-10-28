// De los ajustes del usuario a las opciones del motor.

import type { EngineOptions, PerformanceOptions } from 'tr-bindings'

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
  if (settings.voiceThreshold > 0) options.voiceThreshold = settings.voiceThreshold
  if (settings.overlay.keepWhileUnchanged) options.keepTranslation = true
  // `0` es "automático": no se envía y el motor usa su valor por defecto.
  const { intraThreads, beamWidth, cacheCapacity, ocrMaxSide, lowMemory } = settings.performance
  const performance: PerformanceOptions = {}
  if (intraThreads > 0) performance.intraThreads = intraThreads
  if (beamWidth > 0) performance.beamWidth = beamWidth
  if (cacheCapacity > 0) performance.cacheCapacity = cacheCapacity
  if (ocrMaxSide > 0) performance.ocrMaxSide = ocrMaxSide
  if (lowMemory) performance.lowMemory = true
  if (Object.keys(performance).length > 0) options.performance = performance
  return options
}
