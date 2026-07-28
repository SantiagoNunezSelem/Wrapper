export const seriesPalette = [
  '#c084fc',
  '#22d3ee',
  '#f472b6',
  '#fb923c',
  '#a3e635',
  '#facc15',
  '#60a5fa',
  '#34d399',
  '#f87171',
  '#818cf8',
]

export function colorForIndex(index: number): string {
  return seriesPalette[index % seriesPalette.length]
}
