// Selector de región: dibuja un rectángulo arrastrable sobre un fondo casi transparente.
// No captura ni guarda la imagen de la pantalla; solo envía el rectángulo elegido (en DIP).

import { initialState, reduce, visibleRect } from './selection.ts'
import type { SelectionInput, SelectionState } from './selection.ts'

const api = window.trSelector
const box = document.getElementById('rect')

let state: SelectionState = initialState(null)
/** En la vista previa solo se mira: ni ratón ni teclado hacen nada. */
let preview = false

function draw(): void {
  if (!box) return
  const visible = visibleRect(state)
  if (!visible) {
    box.hidden = true
    return
  }
  const { rect, previous } = visible
  box.hidden = false
  box.classList.toggle('previous', previous && !preview)
  box.style.left = `${rect.x}px`
  box.style.top = `${rect.y}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

function dispatch(input: SelectionInput): void {
  if (preview) return
  const step = reduce(state, input)
  state = step.state
  draw()
  if (!api) return
  if (step.effect?.type === 'confirm') api.confirm(step.effect.rect)
  else if (step.effect?.type === 'cancel') api.cancel()
  else if (step.effect?.type === 'nextDisplay') api.nextDisplay()
}

if (api) {
  api.onInit((init) => {
    preview = init.preview === true
    state = initialState(init.lastRegion)
    const hint = document.getElementById('hint')
    if (hint) {
      const { index, total } = init.screen
      if (preview) hint.textContent = 'Región seleccionada'
      else if (total > 1) hint.textContent = `Pantalla ${index} de ${total} · Tab para cambiar de pantalla · Arrastra para elegir la región · Esc para cancelar`
    }
    draw()
  })

  const point = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY })
  window.addEventListener('mousedown', (event) => {
    if (event.button === 0) dispatch({ type: 'down', point: point(event) })
  })
  window.addEventListener('mousemove', (event) => dispatch({ type: 'move', point: point(event) }))
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) dispatch({ type: 'up', point: point(event) })
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') event.preventDefault()
    dispatch({ type: 'key', key: event.key })
  })
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    dispatch({ type: 'context' })
  })
}

export {}
