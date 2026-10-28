// Texto de ejemplo de la vista previa del overlay (Apariencia): el mismo que mostraría el overlay con
// los subtítulos elegidos, con una frase de muestra en cada idioma. Lógica pura, sin DOM.

import type { OverlayText } from '../../shared/ipc.ts'
import { linesPerTrack, trackPlan } from '../../shared/overlay-layout.ts'
import type { Settings } from '../../shared/settings.ts'

const SAMPLES: Record<string, string> = {
  en: 'Hello, world. This is a preview of how the subtitles will look.',
  es: 'Hola, mundo. Esta es una vista previa de cómo se verán los subtítulos en pantalla.',
  fr: 'Bonjour le monde. Voici un aperçu de l’aspect des sous-titres à l’écran.',
  de: 'Hallo Welt. Dies ist eine Vorschau darauf, wie die Untertitel aussehen werden.',
  it: 'Ciao mondo. Questa è un’anteprima di come appariranno i sottotitoli sullo schermo.',
}

const FALLBACK = 'Aa Bb Cc. Preview.'

/** Frase de muestra en `lang` (o un texto genérico si no hay una para ese idioma). */
export function sampleFor(lang: string): string {
  return SAMPLES[lang.split('-')[0] ?? lang] ?? FALLBACK
}

/** El texto que el overlay recibiría con los ajustes actuales: el original y una traducción por destino. */
export function previewText(settings: Pick<Settings, 'from' | 'targets'>): OverlayText {
  return {
    original: sampleFor(settings.from),
    lang: settings.from,
    translations: settings.targets.map((lang) => ({ lang, text: sampleFor(lang) })),
    final: true,
  }
}

/** Líneas con que la vista previa dibuja cada subtítulo (las mismas que usaría el overlay en esta pantalla). */
export function previewLines(settings: Pick<Settings, 'targets' | 'overlay'>, screenHeight: number): number {
  return linesPerTrack(settings.overlay.fontSize, settings.overlay.maxLines, trackPlan(settings.targets, settings.overlay.showOriginal), screenHeight)
}
