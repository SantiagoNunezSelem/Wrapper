/**
 * Los videos del tutorial de exportación (pasos 2 y 3 de Android) y su precarga.
 *
 * El paso 1 del tutorial ("Instalá Vistazo como app") no tiene video, y la persona se
 * queda leyéndolo unos segundos. Ese tiempo se aprovecha para bajar los dos videos
 * enteros: cuando toca "Siguiente", el video sale de memoria (una URL `blob:`) y
 * aparece al instante, sin volver a pedirlo a la red.
 */
export const tutorialVideoSources = ['/tutorial/export-android-step2.mp4', '/tutorial/export-android-step3.mp4'] as const

/** src → URL `blob:` ya descargada. Vive lo que vive la pestaña: son ~800 KB en total. */
const readyUrls = new Map<string, string>()
const inFlight = new Set<string>()

/** Empieza a bajar los videos que todavía no estén. Llamarla de más no cuesta nada. */
export function preloadTutorialVideos() {
  if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
    return
  }

  for (const src of tutorialVideoSources) {
    if (readyUrls.has(src) || inFlight.has(src)) {
      continue
    }
    inFlight.add(src)
    fetch(src)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`${response.status}`))))
      .then((blob) => {
        readyUrls.set(src, URL.createObjectURL(blob))
      })
      .catch(() => {
        // Sin precarga el video se pide igual cuando se muestra, con su spinner.
      })
      .finally(() => {
        inFlight.delete(src)
      })
  }
}

/** La URL con la que conviene reproducir `src`: la de memoria si ya está, si no la de red. */
export function tutorialVideoUrl(src: string): string {
  return readyUrls.get(src) ?? src
}
