// Preload del overlay: recibe texto y estilo. Lo único que puede enviar es el desplazamiento de
// un arrastre y el fin del modo "mover", que el proceso principal solo atiende mientras ese modo
// está activo. Importa de `shared/` únicamente tipos (ver `selector.ts`).

import { contextBridge, ipcRenderer } from 'electron'

import type { Channel, OverlayApi, OverlayMode, OverlayStyle, OverlayText } from '../shared/ipc.ts'

const SHOW = 'overlay:show' satisfies typeof Channel.overlayShow
const STYLE = 'overlay:style' satisfies typeof Channel.overlayStyle
const CLEAR = 'overlay:clear' satisfies typeof Channel.overlayClear
const MODE = 'overlay:mode' satisfies typeof Channel.overlayMode
const MOVE_MODE = 'overlay:move-mode' satisfies typeof Channel.overlayMoveMode
const DRAG = 'overlay:drag' satisfies typeof Channel.overlayDrag
const MOVE_DONE = 'overlay:move-done' satisfies typeof Channel.overlayMoveDone

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
  onMoveMode(listener) {
    ipcRenderer.on(MOVE_MODE, (_event, active: boolean) => listener(active))
  },
  drag(dx, dy) {
    ipcRenderer.send(DRAG, dx, dy)
  },
  endMove() {
    ipcRenderer.send(MOVE_DONE)
  },
}

contextBridge.exposeInMainWorld('trOverlay', api)
