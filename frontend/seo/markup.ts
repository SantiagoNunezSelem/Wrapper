/**
 * El mini-markup con el que se escribe el contenido de las páginas (`pages.ts`).
 *
 * Alcanza con tres cosas: `[texto](/ruta)` para un link interno, `**negrita**` y
 * `` `código` ``. Todo lo demás se escapa, así que un `<` en el texto nunca llega al HTML
 * como etiqueta, y los links sólo pueden apuntar a una ruta del propio sitio.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Texto con mini-markup → HTML seguro. */
export function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** Texto con mini-markup → texto plano (para meta tags y datos estructurados). */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(\/[^)\s]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

/** Las rutas internas a las que apunta un texto (`](/ruta)`), sin ancla ni query. */
export function internalLinks(text: string): string[] {
  return [...text.matchAll(/\]\((\/[^)\s#?]*)/g)].map((match) => match[1])
}
