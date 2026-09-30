import { useEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'

/** Qué fracción del alto de la hoja hay que arrastrarla para que se cierre. */
const CLOSE_FRACTION = 0.3
/** Cuánto tiene que moverse el dedo antes de decidir si es un arrastre o un scroll. */
const DRAG_SLOP_PX = 6
const SETTLE_MS = 220

/**
 * Arrastrar una hoja de mobile hacia abajo para cerrarla — el gesto que promete la
 * barrita de arriba (`.m-grabber`).
 *
 * Se mueve la hoja entera y sólo hacia abajo. Pasado el 30% de su alto se cierra
 * (lo mismo que la cruz); si se suelta antes, vuelve a su lugar.
 *
 * El gesto sólo arranca en la cabecera: la barrita y el título. El contenido (el
 * número, el subtítulo, los gráficos) nunca mueve la hoja — ahí tirar hacia abajo es
 * scrollear. Un movimiento más de costado que vertical tampoco cuenta.
 *
 * Eventos táctiles y no pointer events a propósito: es un gesto de teléfono, y con
 * mouse la hoja se sigue cerrando con la cruz, el fondo o Escape.
 */
export function useSheetDrag(panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const sheet: HTMLElement = panel
    const scrim = sheet.parentElement?.querySelector<HTMLElement>('.m-scrim') ?? null

    let startX = 0
    let startY = 0
    let offset = 0
    let canDrag = false
    let dragging = false
    let closing = false

    function apply(y: number, animate: boolean) {
      const transition = animate && !prefersReducedMotion() ? `transform ${SETTLE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)` : 'none'
      sheet.style.transition = transition
      sheet.style.transform = y > 0 ? `translateY(${y}px)` : ''
      if (scrim) {
        scrim.style.transition = transition.replace('transform', 'opacity')
        scrim.style.opacity = String(1 - Math.min(1, y / sheet.offsetHeight))
      }
    }

    function handleStart(event: TouchEvent) {
      if (closing || event.touches.length !== 1) {
        canDrag = false
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      offset = 0
      dragging = false
      const target = event.target as Element
      canDrag = Boolean(target.closest('.m-grabber, .m-sheet-head'))
    }

    function handleMove(event: TouchEvent) {
      if (!canDrag) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!dragging) {
        if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) {
          return
        }
        // Hacia arriba o de costado: es scroll del contenido, no arrastre de la hoja.
        if (dy <= 0 || Math.abs(dx) > dy) {
          canDrag = false
          return
        }
        dragging = true
      }

      // Sin esto el navegador scrollea (o rebota) el contenido mientras la hoja baja.
      event.preventDefault()
      offset = Math.max(0, dy)
      apply(offset, false)
    }

    function handleEnd() {
      if (!dragging) {
        return
      }
      dragging = false
      canDrag = false

      if (offset >= sheet.offsetHeight * CLOSE_FRACTION) {
        closing = true
        apply(sheet.offsetHeight, true)
        window.setTimeout(() => onCloseRef.current(), prefersReducedMotion() ? 0 : SETTLE_MS)
      } else {
        apply(0, true)
      }
    }

    sheet.addEventListener('touchstart', handleStart, { passive: true })
    sheet.addEventListener('touchmove', handleMove, { passive: false })
    sheet.addEventListener('touchend', handleEnd)
    sheet.addEventListener('touchcancel', handleEnd)
    return () => {
      sheet.removeEventListener('touchstart', handleStart)
      sheet.removeEventListener('touchmove', handleMove)
      sheet.removeEventListener('touchend', handleEnd)
      sheet.removeEventListener('touchcancel', handleEnd)
    }
  }, [panelRef])
}
