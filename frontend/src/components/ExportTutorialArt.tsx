import { useEffect, useRef, useState } from 'react'
import { tutorialVideos, tutorialVideoUrl, type TutorialVideoSource } from '../lib/tutorialVideos'

/**
 * Lo que se ve al lado (desktop) o arriba (mobile) de cada paso del tutorial
 * "¿Cómo exporto mi chat?": grabaciones reales de WhatsApp.
 */

export type ExportTutorialPlatform = 'ios' | 'android'

/**
 * Un video del tutorial con un spinner encima hasta que llega el primer cuadro. Los
 * MP4 pesan varios MB y sin esto el paso quedaba vacío unos segundos, como si
 * estuviera roto. El contenedor ya tiene la proporción del video, así que el spinner
 * ocupa el mismo lugar que el video y nada salta cuando aparece.
 */
function TutorialVideo({ video: { src, aspect }, label }: { video: TutorialVideoSource; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Si el video ya estaba en caché, `loadeddata` puede dispararse antes de que React
  // enganche el handler: se mira el estado directamente al montar.
  useEffect(() => {
    if ((videoRef.current?.readyState ?? 0) >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className={`tutorial-video ${isLoading ? 'is-loading' : ''}`} style={{ aspectRatio: aspect }}>
      <video
        ref={videoRef}
        // Precargado en memoria si el tutorial ya lo bajó (ver lib/tutorialVideos).
        src={tutorialVideoUrl(src)}
        className="tutorial-gif"
        aria-label={label}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setIsLoading(false)}
        // Sin video no tiene sentido dejar el spinner girando para siempre.
        onError={() => setIsLoading(false)}
      />
      {isLoading ? <span className="tutorial-video-spinner" role="status" aria-label={label} /> : null}
    </div>
  )
}

/**
 * El video de cada paso, o `null` si el paso no lleva: el 1 de Android ("instalar la
 * app") muestra el ícono en su lugar, y el 2 de iOS ("subí el archivo") es sólo texto.
 */
const stepVideos: Record<ExportTutorialPlatform, ReadonlyArray<TutorialVideoSource | null>> = {
  android: [null, tutorialVideos.androidExport, tutorialVideos.androidShare],
  ios: [tutorialVideos.iosExport, null],
}

export function tutorialStepVideo(platform: ExportTutorialPlatform, step: number): TutorialVideoSource | null {
  return stepVideos[platform][step] ?? null
}

export function ExportTutorialArt({ step, platform }: { step: number; platform: ExportTutorialPlatform }) {
  const video = tutorialStepVideo(platform, step)
  // `key`: al pasar de un paso al otro el spinner vuelve a arrancar desde cero.
  return video ? <TutorialVideo key={video.src} video={video} label={`Paso ${step + 1}`} /> : null
}
