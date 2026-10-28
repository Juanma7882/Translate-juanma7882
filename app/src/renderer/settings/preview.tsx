// Las líneas de la vista previa del overlay (Apariencia): las mismas que dibujaría el overlay con los
// subtítulos elegidos, con la etiqueta del idioma cuando hay dos y el límite de líneas efectivo.

import type { Settings } from '../../shared/settings.ts'
import { viewFor } from '../overlay/view.ts'
import { previewLines, previewText } from './preview.ts'

export function PreviewLines({ settings }: { settings: Settings }) {
  const view = viewFor(previewText(settings), settings.overlay)
  const lines = previewLines(settings, window.screen.availHeight)
  return (
    <>
      {view.lines.map((line) => (
        <div key={line.lang} class={line.secondary ? 'track secondary' : 'track'} lang={line.lang} style={line.secondary ? undefined : { WebkitLineClamp: String(lines) }}>
          {view.labeled && (
            <span class="lang-tag" aria-hidden="true">
              {line.lang.toUpperCase()}
            </span>
          )}
          <span>{line.text}</span>
        </div>
      ))}
    </>
  )
}
