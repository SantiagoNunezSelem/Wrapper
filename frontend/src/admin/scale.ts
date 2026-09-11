/** El máximo del eje redondeado a 1, 2 o 5 × 10ⁿ, para que las marcas caigan en números limpios. */
export function niceMax(value: number): number {
  const safe = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safe))
  const fraction = safe / magnitude
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * magnitude
}
