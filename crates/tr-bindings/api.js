'use strict'

// Capa fina sobre el módulo nativo (index.js, generado por napi-rs). Aporta:
//  - varios suscriptores por evento, con baja;
//  - la garantía de que tras `stop()` no llega ningún evento de la sesión, incluidos los que ya
//    estaban en la cola de entrega hacia JS cuando el motor terminó;
//  - la pausa: mientras dura no llegan traducciones ni subtítulos aunque ya estuvieran en cola;
//  - el progreso de modelos, que es independiente de la sesión (una descarga puede ocurrir sin
//    traducción en marcha);
//  - funciones asíncronas que siempre devuelven una promesa (los errores síncronos se rechazan);
//  - la escucha previa del nivel de audio (`startAudioMonitor`), que no es una sesión: sus niveles
//    llegan aunque no haya nada en marcha y una sesión la reemplaza.

const native = require('./index.js')

const listeners = {
  translation: new Set(),
  subtitle: new Set(),
  error: new Set(),
  modelProgress: new Set(),
  mode: new Set(),
  audioLevel: new Set(),
}

let active = false
let paused = false
let progressDelivered = 0
// Escucha previa del nivel activa. Solo afecta a `onAudioLevel`.
let monitoring = false

const inSession = () => active
const flowing = () => active && !paused
const always = () => true

const dispatch = (name, allowed) => (event) => {
  if (!allowed()) return
  for (const listener of [...listeners[name]]) listener(event)
}

native.onTranslation(dispatch('translation', flowing))
native.onSubtitle(dispatch('subtitle', flowing))
native.onError(dispatch('error', inSession))
const dispatchProgress = dispatch('modelProgress', always)
native.onModelProgress((event) => {
  progressDelivered += 1
  dispatchProgress(event)
})
native.onModeChanged(dispatch('mode', inSession))
native.onAudioLevel(dispatch('audioLevel', () => flowing() || monitoring))

// La promesa de una descarga y sus eventos de progreso llegan a JS por canales distintos y sin
// orden garantizado: antes de resolver o rechazar se espera a haber recibido todos los eventos
// que el motor emitió, para que el último (100 %) nunca llegue después del "terminado".
async function settleProgress() {
  const deadline = Date.now() + 2000
  while (progressDelivered < native.progressEventsEmitted() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

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
  const wasPaused = paused
  const wasMonitoring = monitoring
  active = true
  paused = false
  monitoring = false // la sesión reemplaza la escucha previa
  try {
    start()
  } catch (error) {
    const untouched = wasActive && error?.code === 'InvalidArg'
    active = untouched
    paused = untouched && wasPaused
    // Con argumentos inválidos el motor no se tocó y la escucha sigue; con otro fallo no se sabe.
    monitoring = wasMonitoring && error?.code === 'InvalidArg'
    throw error
  }
}

module.exports = {
  // Si alguna opción es inválida falla sin cambiar nada (la sesión en curso sigue); si no, el
  // motor se reemplaza y lo que estuviera en marcha se detiene.
  configure(options = {}) {
    native.configure(options)
    active = false
    paused = false
  },
  startRegionTranslation(rect, from, to) {
    begin(() => native.startRegionTranslation(rect, from, to))
  },
  // `source`: `{ kind: 'system' }` (por defecto) o `{ kind: 'app', id, name }`.
  startAudioSubtitles(from, to, source) {
    begin(() => native.startAudioSubtitles(from, to, source))
  },
  // Síncrona: `{ supported: true, apps: [{ id, name }] }` o `{ supported: false, reason }`.
  listAudioSources() {
    const { supported, apps, reason } = native.listAudioSources()
    return supported ? { supported: true, apps: apps ?? [] } : { supported: false, reason: reason ?? '' }
  },
  // Umbral de voz del motor (RMS de 0 a 1), para la marca de la barra de nivel.
  audioVoiceThreshold() {
    return native.audioVoiceThreshold()
  },
  // Escucha previa: mide el nivel de `source` (por defecto, todo el sistema) sin sesión ni modelos;
  // los niveles llegan por `onAudioLevel`. Devuelve `false`, sin abrir nada, si hay una sesión en marcha.
  // Si la fuente no se puede abrir lanza con el motivo.
  startAudioMonitor(source) {
    monitoring = false
    monitoring = native.startAudioMonitor(source)
    return monitoring
  },
  // Detiene la escucha previa. Idempotente.
  stopAudioMonitor() {
    monitoring = false // primero, para descartar de inmediato lo que ya estuviera en cola
    native.stopAudioMonitor()
  },
  stop() {
    active = false
    paused = false
    native.stop()
  },
  pause() {
    if (!active) return
    paused = true // primero, para descartar de inmediato lo que ya estuviera en cola
    native.pause()
  },
  resume() {
    if (!active) return
    native.resume()
    paused = false
  },
  modelCatalog() {
    return native.modelCatalog()
  },
  async modelStatus(from, to, scope) {
    return native.modelStatus(from, to, scope)
  },
  async downloadModels(from, to, scope) {
    try {
      await native.downloadModels(from, to, scope)
    } finally {
      await settleProgress()
    }
  },
  async modelInventory() {
    return native.modelInventory()
  },
  // Los errores síncronos (sesión en marcha) también llegan como rechazo de la promesa.
  async deleteModel(id) {
    return native.deleteModel(id)
  },
  // Cancela la descarga en curso; `downloadModels` se rechaza con "download cancelled".
  async cancelModelDownload() {
    native.cancelModelDownload()
  },
  validateModelsDir(path) {
    return native.validateModelsDir(path)
  },
  // Solo contadores de la caché de traducciones del motor actual; nunca contenido.
  cacheStats() {
    return native.cacheStats()
  },
  onTranslation: subscribe('translation'),
  onSubtitle: subscribe('subtitle'),
  onError: subscribe('error'),
  onModelProgress: subscribe('modelProgress'),
  onModeChanged: subscribe('mode'),
  // `{ rms, peak }` (0 a 1) por cada trozo de 100 ms mientras haya sesión o escucha previa; solo números.
  onAudioLevel: subscribe('audioLevel'),
}
