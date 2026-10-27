'use strict'

// Capa fina sobre el módulo nativo (index.js, generado por napi-rs). Aporta:
//  - varios suscriptores por evento, con baja;
//  - la garantía de que tras `stop()` no llega ningún evento, incluidos los que ya estaban
//    en la cola de entrega hacia JS cuando el motor terminó.

const native = require('./index.js')

const listeners = {
  translation: new Set(),
  subtitle: new Set(),
  error: new Set(),
  modelProgress: new Set(),
  mode: new Set(),
}

let active = false

const dispatch = (name) => (event) => {
  if (!active) return
  for (const listener of [...listeners[name]]) listener(event)
}

native.onTranslation(dispatch('translation'))
native.onSubtitle(dispatch('subtitle'))
native.onError(dispatch('error'))
native.onModelProgress(dispatch('modelProgress'))
native.onModeChanged(dispatch('mode'))

const subscribe = (name) => (listener) => {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function')
  listeners[name].add(listener)
  return () => {
    listeners[name].delete(listener)
  }
}

// Un arranque con argumentos inválidos no toca lo que ya estuviera en marcha; cualquier otro
// fallo llega después de detenerlo.
function begin(start) {
  const wasActive = active
  active = true
  try {
    start()
  } catch (error) {
    active = wasActive && error?.code === 'InvalidArg'
    throw error
  }
}

module.exports = {
  configure(options = {}) {
    active = false
    native.configure(options)
  },
  startRegionTranslation(rect, from, to) {
    begin(() => native.startRegionTranslation(rect, from, to))
  },
  startAudioSubtitles(from, to) {
    begin(() => native.startAudioSubtitles(from, to))
  },
  stop() {
    active = false
    native.stop()
  },
  onTranslation: subscribe('translation'),
  onSubtitle: subscribe('subtitle'),
  onError: subscribe('error'),
  onModelProgress: subscribe('modelProgress'),
  onModeChanged: subscribe('mode'),
}
