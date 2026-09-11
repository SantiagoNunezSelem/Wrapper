/**
 * Guarda en disco un archivo que ya está en memoria, con el nombre dado.
 *
 * El link temporal se libera un rato después y no enseguida: hay navegadores que todavía
 * lo están leyendo cuando `click()` vuelve, y la descarga sale vacía.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
