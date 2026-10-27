// Renderer del overlay: muestra original y traducción y se oculta solo pasado un tiempo.
// Actualiza el texto con `textContent` (nunca HTML) y la apariencia con variables CSS.
// Solo recibe datos: no puede enviar nada al proceso principal ni guarda el texto.

import type { OverlayMode, OverlayStyle, OverlayText } from '../../shared/ipc.ts'
import { ACTIVE_LABELS } from '../../shared/mode.ts'
import { MODE_FLASH_MS, viewFor } from './view.ts'

const api = window.trOverlay
const box = document.getElementById('box')
const original = document.getElementById('original')
const translated = document.getElementById('translated')
const modeLabel = document.getElementById('mode')

let style: OverlayStyle = { opacity: 0.85, fontSize: 28, fontFamily: 'Arial, sans-serif', showOriginal: true, hideAfterMs: 4000 }
let hideTimer: ReturnType<typeof setTimeout> | undefined

function hide(): void {
  clearTimeout(hideTimer)
  if (box) box.hidden = true
  if (original) original.textContent = ''
  if (translated) translated.textContent = ''
}

function show(text: OverlayText): void {
  if (!box || !original || !translated) return
  const view = viewFor(text, style)
  original.textContent = view.original
  translated.textContent = view.main
  box.classList.toggle('provisional', view.provisional)
  box.hidden = false
  clearTimeout(hideTimer)
  if (style.hideAfterMs > 0) hideTimer = setTimeout(hide, style.hideAfterMs)
}

/** Etiqueta del modo activo; si la caja estaba oculta, se muestra unos segundos solo con la etiqueta. */
function setMode(mode: OverlayMode): void {
  if (!box || !modeLabel) return
  const changed = modeLabel.dataset['mode'] !== mode
  modeLabel.dataset['mode'] = mode
  modeLabel.textContent = ACTIVE_LABELS[mode]
  if (changed && box.hidden) {
    box.hidden = false
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, MODE_FLASH_MS)
  }
}

function applyStyle(next: OverlayStyle): void {
  style = next
  const root = document.documentElement.style
  root.setProperty('--opacity', String(next.opacity))
  root.setProperty('--font-size', `${next.fontSize}px`)
  root.setProperty('--font-family', next.fontFamily)
}

if (api) {
  api.onShow(show)
  api.onStyle(applyStyle)
  api.onClear(hide)
  api.onMode(setMode)
}

export {}
