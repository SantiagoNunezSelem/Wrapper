import { useEffect, useRef } from 'react'

/**
 * Lo que un diálogo necesita para portarse como tal, en un solo lugar.
 *
 * Las hojas de mobile ya resolvían parte de esto cada una por su cuenta (Escape
 * y bloqueo del scroll copiados en tres archivos) y los modales de desktop no
 * resolvían nada: la página de atrás scrolleaba, Escape no cerraba, el foco se
 * quedaba en el botón que había abierto el modal y Tab recorría la página
 * tapada. Todo eso vive acá y lo comparten los dos shells.
 *
 * Devuelve la ref que hay que colgar del panel del diálogo — es lo que delimita
 * qué queda adentro de la trampa de foco.
 */

/** Lo que puede recibir foco adentro del diálogo. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/* Pila de diálogos abiertos. Con dos capas encima —la confirmación de desbloqueo
   sobre el detalle de la métrica, por ejemplo— Escape tiene que cerrar sólo la
   de arriba; sin esto cerraría las dos de un saque, y las dos trampas de foco
   pelearían por el Tab. */
const dialogStack: symbol[] = []

/* El scroll del fondo se bloquea una vez y se devuelve una sola vez, sin
   importar cuántas capas haya apiladas: cada una guardando y restaurando el
   valor por su cuenta es como el `overflow` termina pisado. */
let scrollLockCount = 0
let previousBodyOverflow = ''

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow
  }
}

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // Descarta lo que está en una rama oculta — el detalle de una métrica, por
    // ejemplo, va dentro de un `<div hidden>` cuando la IA todavía no dio un
    // veredicto, y Tab no debería aterrizar ahí. Se mira el atributo y no
    // `offsetParent`, que además de ser null para cualquier elemento `fixed`
    // depende de que haya layout calculado.
    (node) => node.closest('[hidden]') === null && node.getAttribute('aria-hidden') !== 'true',
  )
}

export interface ModalDismissOptions {
  /** Teclas propias del diálogo (las flechas de la hoja de métricas, p. ej.).
   * Sólo se llama cuando este diálogo es el de más arriba en la pila. */
  onKeyDown?: (event: KeyboardEvent) => void
  /** Poner en false donde el diálogo no deba tomarse el foco al abrirse. */
  moveFocus?: boolean
}

export function useModalDismiss<T extends HTMLElement>(
  onDismiss: () => void,
  options: ModalDismissOptions = {},
) {
  const panelRef = useRef<T | null>(null)
  const dismissRef = useRef(onDismiss)
  const keyDownRef = useRef(options.onKeyDown)
  const moveFocus = options.moveFocus ?? true

  /* Las funciones se guardan en refs y se refrescan en cada render para que el
     listener de abajo se registre UNA vez, al abrir: re-suscribirlo en cada
     render volvería a mover el foco y a re-apilar el diálogo. */
  useEffect(() => {
    dismissRef.current = onDismiss
    keyDownRef.current = options.onKeyDown
  })

  useEffect(() => {
    const token = Symbol('vz-dialog')
    dialogStack.push(token)

    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current

    if (panel && moveFocus) {
      const first = focusableWithin(panel)[0]
      if (first) {
        first.focus()
      } else {
        // Un diálogo sin nada enfocable adentro igual tiene que recibir el foco:
        // si no, un lector de pantalla sigue leyendo la página de atrás.
        panel.tabIndex = -1
        panel.focus()
      }
    }

    lockBodyScroll()

    function handleKeyDown(event: KeyboardEvent) {
      if (dialogStack[dialogStack.length - 1] !== token) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRef.current()
        return
      }

      keyDownRef.current?.(event)

      if (event.key !== 'Tab') {
        return
      }

      const currentPanel = panelRef.current
      if (!currentPanel) {
        return
      }

      const focusables = focusableWithin(currentPanel)
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      // El Tab da la vuelta adentro del diálogo en vez de salirse a la página
      // que el diálogo está tapando.
      if (event.shiftKey && (active === first || !currentPanel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !currentPanel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)

      const at = dialogStack.indexOf(token)
      if (at >= 0) {
        dialogStack.splice(at, 1)
      }

      unlockBodyScroll()

      // Devolver el foco a lo que lo tenía antes es lo que hace que cerrar un
      // modal con teclado no mande al usuario al principio de la página.
      previouslyFocused?.focus?.()
    }
  }, [moveFocus])

  return panelRef
}
