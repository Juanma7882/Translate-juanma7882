// Renderer del overlay: muestra original y traducción y se oculta solo pasado un tiempo.
// Actualiza el texto con `textContent` (nunca HTML) y la apariencia con variables CSS.
// Normalmente solo recibe datos. En el modo "mover" (que activa el proceso principal) permite
// arrastrar la ventana y envía únicamente el desplazamiento del puntero.

import type { OverlayMode, OverlayStyle, OverlayText } from '../../shared/ipc.ts'
import { ACTIVE_LABELS } from '../../shared/mode.ts'
import type { OverlayLine } from './view.ts'
import { cssVariables, MODE_FLASH_MS, MOVE_PLACEHOLDER, viewFor } from './view.ts'

const api = window.trOverlay
const box = document.getElementById('box')
const tracks = document.getElementById('tracks')
const modeLabel = document.getElementById('mode')
const moveBar = document.getElementById('move-bar')
const moveDone = document.getElementById('move-done')

let style: OverlayStyle = {
  opacity: 0.85,
  fontSize: 28,
  fontFamily: 'Arial, sans-serif',
  showOriginal: true,
  hideAfterMs: 4000,
  textColor: '#ffffff',
  backgroundColor: '#0c0c10',
  maxLines: 2,
}
let hideTimer: ReturnType<typeof setTimeout> | undefined
let moving = false
/** `true` mientras la caja muestra el texto de ejemplo del modo "mover" y no una traducción. */
let placeholder = false

function hide(): void {
  clearTimeout(hideTimer)
  if (moving) return // en el modo "mover" la caja se queda visible
  if (box) box.hidden = true
  tracks?.replaceChildren()
  placeholder = false
}

/** Un párrafo por subtítulo; el texto entra solo como `textContent`, nunca como HTML. */
function track(line: OverlayLine, labeled: boolean): HTMLParagraphElement {
  const paragraph = document.createElement('p')
  paragraph.className = line.secondary ? 'track secondary' : 'track'
  paragraph.lang = line.lang
  if (labeled) {
    const tag = document.createElement('span')
    tag.className = 'lang-tag'
    tag.setAttribute('aria-hidden', 'true')
    tag.textContent = line.lang.toUpperCase()
    paragraph.append(tag)
  }
  const body = document.createElement('span')
  body.textContent = line.text
  paragraph.append(body)
  return paragraph
}

function show(text: OverlayText): void {
  if (!box || !tracks) return
  const view = viewFor(text, style)
  tracks.replaceChildren(...view.lines.map((line) => track(line, view.labeled)))
  placeholder = false
  box.classList.toggle('provisional', view.provisional)
  box.hidden = false
  clearTimeout(hideTimer)
  if (style.hideAfterMs > 0 && !moving) hideTimer = setTimeout(hide, style.hideAfterMs)
}

/**
 * Etiqueta del modo activo; si la caja estaba oculta, se muestra unos segundos solo con la etiqueta.
 * En modo texto no hay etiqueta: es lo esperado y solo estorbaría encima de la traducción.
 */
function setMode(mode: OverlayMode): void {
  if (!box || !modeLabel) return
  const changed = modeLabel.dataset['mode'] !== mode
  modeLabel.dataset['mode'] = mode
  modeLabel.textContent = mode === 'text' ? '' : ACTIVE_LABELS[mode]
  if (changed && box.hidden && modeLabel.textContent) {
    box.hidden = false
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, MODE_FLASH_MS)
  }
}

function applyStyle(next: OverlayStyle): void {
  style = next
  const root = document.documentElement.style
  for (const [name, value] of Object.entries(cssVariables(next))) root.setProperty(name, value)
}

// ---------------------------------------------------------------------------- modo "mover"

function setMoving(active: boolean): void {
  if (!box || !tracks || !moveBar) return
  moving = active
  box.classList.toggle('moving', active)
  moveBar.hidden = !active
  clearTimeout(hideTimer)
  if (active) {
    box.hidden = false
    if (tracks.childElementCount === 0) {
      tracks.replaceChildren(track({ lang: document.documentElement.lang || 'es', text: MOVE_PLACEHOLDER, kind: 'translation', secondary: false }, false))
      placeholder = true
    }
  } else if (placeholder) {
    hide()
  } else if (style.hideAfterMs > 0) {
    hideTimer = setTimeout(hide, style.hideAfterMs)
  }
}

let last: { x: number; y: number } | null = null

function startDrag(event: PointerEvent): void {
  if (!moving || event.button !== 0 || !box) return
  if (event.target instanceof Element && event.target.closest('#move-done')) return
  last = { x: event.screenX, y: event.screenY }
  try {
    box.setPointerCapture(event.pointerId)
  } catch {
    // Sin captura (puntero no activo) el arrastre sigue por los eventos del propio cuadro.
  }
}

function drag(event: PointerEvent): void {
  if (!last || !api) return
  const dx = event.screenX - last.x
  const dy = event.screenY - last.y
  last = { x: event.screenX, y: event.screenY }
  if (dx !== 0 || dy !== 0) api.drag(dx, dy)
}

function endDrag(event: PointerEvent): void {
  last = null
  try {
    if (box?.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId)
  } catch {
    // Nada que soltar.
  }
}

if (api) {
  api.onShow(show)
  api.onStyle(applyStyle)
  api.onClear(hide)
  api.onMode(setMode)
  api.onMoveMode(setMoving)
  box?.addEventListener('pointerdown', startDrag)
  box?.addEventListener('pointermove', drag)
  box?.addEventListener('pointerup', endDrag)
  box?.addEventListener('pointercancel', endDrag)
  moveDone?.addEventListener('click', () => api.endMove())
}

export {}
