/**
 * Los videos del tutorial de exportación y su precarga.
 *
 * Se bajan enteros apenas se abre el tutorial, de las dos plataformas: el paso 1 de
 * Android ("Instalá Vistazo como app") no tiene video y la persona se queda leyéndolo
 * unos segundos, y ese tiempo alcanza para que, al tocar "Siguiente" o al cambiar a
 * iOS, el video salga de memoria (una URL `blob:`) y aparezca al instante.
 *
 * Todos van a 720 px, 30 fps, sin audio y con el índice (moov) al principio, para que
 * arranquen a reproducir sin esperar el archivo entero. `aspect` es ancho / alto: el
 * contenedor lo reserva desde antes de que cargue, así nada salta.
 */
export interface TutorialVideoSource {
  src: string
  aspect: number
}

export const tutorialVideos = {
  androidExport: { src: '/tutorial/export-android-step2.mp4', aspect: 720 / 900 },
  androidShare: { src: '/tutorial/export-android-step3-v2.mp4', aspect: 720 / 900 },
  iosExport: { src: '/tutorial/export-ios-step1.mp4', aspect: 1 },
} satisfies Record<string, TutorialVideoSource>

const tutorialVideoSources = Object.values(tutorialVideos).map((video) => video.src)

/** src → URL `blob:` ya descargada. Vive lo que vive la pestaña: son ~1 MB en total. */
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
