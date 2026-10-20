/**
 * Qué fondo lleva cada pantalla del modo historia: el dibujo según la posición
 * y el color según el acento de la métrica. Vive aparte de StoryBackdrop para
 * que ese archivo exporte sólo el componente (si no, se pierde el fast refresh).
 */

export type StoryPattern = 'dots' | 'chat' | 'doodles' | 'stripes' | 'blobs'
export type StoryScheme = 'green' | 'black' | 'cream'

const PATTERNS: StoryPattern[] = ['dots', 'chat', 'doodles', 'stripes', 'blobs']

/** Pantallas seguidas nunca repiten dibujo: rotan en orden fijo. */
export function storyPatternFor(index: number): StoryPattern {
  return PATTERNS[index % PATTERNS.length]
}

/* Los mismos grupos que usa mobile.css para los colores de texto (los
   `.m-story:has(.m-story-plate:is(...))`): si cambia uno, cambia el otro. */
const BLACK_ACCENTS = new Set(['tier-purple', 'tier-indigo', 'tier-violet', 'tier-slate', 'tier-blue', 'tier-magenta'])
const CREAM_ACCENTS = new Set(['tier-gold', 'tier-yellow', 'tier-orange', 'tier-rose'])

export function storySchemeFor(accent: string): StoryScheme {
  if (BLACK_ACCENTS.has(accent)) return 'black'
  if (CREAM_ACCENTS.has(accent)) return 'cream'
  return 'green'
}
