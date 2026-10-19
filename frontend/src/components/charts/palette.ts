export const seriesPalette = [
  // Rediseño: el verde de marca primero y después colores de "remitente" de un
  // grupo de WhatsApp — saturados y oscuros, para leerse sobre blanco y crema.
  '#1ed760',
  '#1565c0',
  '#c2185b',
  '#e65100',
  '#7b1fa2',
  '#00897b',
  '#f9a825',
  '#3949ab',
  '#d32f2f',
  '#558b2f',
]

export function colorForIndex(index: number): string {
  return seriesPalette[index % seriesPalette.length]
}
