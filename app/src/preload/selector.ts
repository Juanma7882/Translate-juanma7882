// Preload del selector de región: solo puede recibir el estado inicial y devolver una región.
//
// Importa de `shared/` únicamente tipos (un preload con sandbox no puede cargar otros archivos);
// `satisfies` comprueba en compilación que los canales coinciden con los del proceso principal.

import { contextBridge, ipcRenderer } from 'electron'

import type { Channel, DipRect, SelectorApi, SelectorInit } from '../shared/ipc.ts'

const INIT = 'selector:init' satisfies typeof Channel.selectorInit
const CONFIRM = 'selector:confirm' satisfies typeof Channel.selectorConfirm
const CANCEL = 'selector:cancel' satisfies typeof Channel.selectorCancel

const NEXT_DISPLAY = 'selector:next-display' satisfies typeof Channel.selectorNextDisplay

const api: SelectorApi = {
  onInit(listener) {
    ipcRenderer.on(INIT, (_event, init: SelectorInit) => listener(init))
  },
  confirm(rect: DipRect) {
    ipcRenderer.send(CONFIRM, rect)
  },
  cancel() {
    ipcRenderer.send(CANCEL)
  },
  nextDisplay() {
    ipcRenderer.send(NEXT_DISPLAY)
  },
}

contextBridge.exposeInMainWorld('trSelector', api)
