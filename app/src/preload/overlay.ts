// Preload del overlay: solo recibe texto y estilo; no puede enviar nada al proceso principal.
// Importa de `shared/` únicamente tipos (ver `selector.ts`).

import { contextBridge, ipcRenderer } from 'electron'

import type { Channel, OverlayApi, OverlayStyle, OverlayText } from '../shared/ipc.ts'

const SHOW = 'overlay:show' satisfies typeof Channel.overlayShow
const STYLE = 'overlay:style' satisfies typeof Channel.overlayStyle
const CLEAR = 'overlay:clear' satisfies typeof Channel.overlayClear

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
}

contextBridge.exposeInMainWorld('trOverlay', api)
