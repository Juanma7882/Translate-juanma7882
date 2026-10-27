// Selector de región: dibuja un rectángulo arrastrable sobre un fondo casi transparente.
// No captura ni guarda la imagen de la pantalla; solo envía el rectángulo elegido (en DIP).

import { initialState, reduce, visibleRect } from './selection.ts'
import type { SelectionInput, SelectionState } from './selection.ts'

const api = window.trSelector
const box = document.getElementById('rect')

let state: SelectionState = initialState(null)

function draw(): void {
  if (!box) return
  const visible = visibleRect(state)
  if (!visible) {
    box.hidden = true
    return
  }
  const { rect, previous } = visible
  box.hidden = false
  box.classList.toggle('previous', previous)
  box.style.left = `${rect.x}px`
  box.style.top = `${rect.y}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

function dispatch(input: SelectionInput): void {
  const step = reduce(state, input)
  state = step.state
  draw()
  if (!api) return
  if (step.effect?.type === 'confirm') api.confirm(step.effect.rect)
  else if (step.effect?.type === 'cancel') api.cancel()
}

if (api) {
  api.onInit((init) => {
    state = initialState(init.lastRegion)
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
  window.addEventListener('keydown', (event) => dispatch({ type: 'key', key: event.key }))
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    dispatch({ type: 'context' })
  })
}

export {}
