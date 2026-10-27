// Preload del overlay: solo recibe texto y estilo; no puede enviar nada al proceso principal.
// Importa de `shared/` únicamente tipos (ver `selector.ts`).

import { contextBridge, ipcRenderer } from 'electron'

import type { Channel, OverlayApi, OverlayMode, OverlayStyle, OverlayText } from '../shared/ipc.ts'

const SHOW = 'overlay:show' satisfies typeof Channel.overlayShow
const STYLE = 'overlay:style' satisfies typeof Channel.overlayStyle
const CLEAR = 'overlay:clear' satisfies typeof Channel.overlayClear
const MODE = 'overlay:mode' satisfies typeof Channel.overlayMode

const api: OverlayApi = {
  onShow(listener) {
    ipcRenderer.on(SHOW, (_event, text: OverlayText) => listener(text))
  },
  onStyle(listener) {
    ipcRenderer.on(STYLE, (_event, style: OverlayStyle) => listener(style))
  },
  onClear(listener) {
    ipcRenderer.on(CLEAR, () => listener())
  },
  onMode(listener) {
    ipcRenderer.on(MODE, (_event, mode: OverlayMode) => listener(mode))
  },
}

contextBridge.exposeInMainWorld('trOverlay', api)
