import { useEffect, useState } from 'react'

/** Debajo de esto siempre se monta el shell de mobile. */
const MOBILE_MAX_WIDTH = 768

/** Tope para la rama táctil. Una tablet en vertical se maneja con el dedo y
 * quiere las áreas táctiles de mobile; la misma tablet en horizontal tiene
 * 1366px y ahí el layout de desktop entra bien, así que no se le impone una
 * barra de pestañas pensada para un pulgar. */
const TOUCH_MAX_WIDTH = 1024

const QUERY =
  `(max-width: ${MOBILE_MAX_WIDTH}px), ` +
  `(pointer: coarse) and (hover: none) and (max-width: ${TOUCH_MAX_WIDTH}px)`

/**
 * La única detección de dispositivo de toda la app.
 *
 * Vive acá arriba y sólo la lee `App`, para elegir shell. Ningún componente de
 * más abajo vuelve a preguntar: si un componente necesita comportarse distinto
 * en un teléfono, es señal de que le corresponde una versión propia en
 * `shells/mobile/`, no un `if` adentro.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(QUERY)

    function sync() {
      setIsMobile(media.matches)
    }

    // Rotar el teléfono o achicar la ventana cambia de shell en vivo, sin recargar.
    media.addEventListener('change', sync)
    /* Respaldo: hay entornos —navegadores embebidos, herramientas de
       automatización que redimensionan por CDP— donde el viewport cambia pero
       el evento `change` de la media query nunca llega. Releer `matches` en cada
       resize los cubre, y cuando el valor no cambió React descarta el render. */
    window.addEventListener('resize', sync)
    // El estado inicial se resolvió en el useState, pero entre ese render y este
    // efecto la ventana pudo cambiar de tamaño — se resincroniza por las dudas.
    sync()

    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  return isMobile
}
