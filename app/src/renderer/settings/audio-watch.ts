// Enlace entre Inicio y la escucha previa del nivel: dice al proceso principal cuándo Inicio está a la vista y
// devuelve el estado de la escucha. Quién decide si de verdad se escucha (sesión, modo, ventana) es main.

import { useEffect, useRef, useState } from 'preact/hooks'

import type { MonitorState, SettingsApi } from '../../shared/ipc.ts'

/**
 * `active`: la pestaña Inicio está seleccionada. Además la ventana debe estar visible (`document.hidden`): minimizarla
 * o taparla del todo apaga la escucha. Al salir de la pestaña o desmontar se declara que ya no se ve.
 */
export function useAudioWatch(api: SettingsApi, active: boolean): MonitorState {
  const [state, setState] = useState<MonitorState>({ phase: 'idle' })
  // Cuenta los avisos del proceso principal: la respuesta de una petición es más vieja que cualquier aviso posterior.
  const events = useRef(0)

  useEffect(() => {
    api.onMonitorState((next) => {
      events.current += 1
      setState(next)
    })
  }, [api])

  useEffect(() => {
    if (!active) return
    const report = (): void => {
      const seen = events.current
      api
        .watchAudioLevel(!document.hidden)
        .then((current) => {
          if (events.current === seen) setState(current)
        })
        .catch(() => undefined)
    }
    report()
    document.addEventListener('visibilitychange', report)
    return () => {
      document.removeEventListener('visibilitychange', report)
      void api.watchAudioLevel(false).catch(() => undefined)
    }
  }, [api, active])

  return state
}
