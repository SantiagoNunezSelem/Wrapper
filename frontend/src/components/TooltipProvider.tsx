import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'

interface TooltipState {
  anchor: HTMLElement
  content: ReactNode
  placement: Placement
}

interface TooltipContextValue {
  show: (anchor: HTMLElement, content: ReactNode, placement: Placement) => void
  hide: (anchor: HTMLElement) => void
  toggle: (anchor: HTMLElement, content: ReactNode, placement: Placement) => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

/**
 * Un único bubble compartido por toda la app, en vez de uno por trigger.
 *
 * Un heatmap de un año monta ~365 celdas con hover — instanciar un tooltip
 * (con su propio nodo, su propio listener de posición) por celda sería 365
 * cosas montadas para mostrar, como mucho, una a la vez. Acá cada trigger
 * sólo registra manejadores de puntero livianos; el nodo del tooltip y el
 * cálculo de posición existen una sola vez, y sólo mientras algo está
 * realmente en hover.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState | null>(null)
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  const controller = useMemo<TooltipContextValue>(
    () => ({
      show: (anchor, content, placement) => setState({ anchor, content, placement }),
      // Sólo cierra si el pedido es del mismo anchor que está mostrando: si el puntero
      // ya saltó a la celda de al lado, el `pointerleave` de la celda vieja llega después
      // del `pointerenter` de la nueva, y no debe pisarle el tooltip recién abierto.
      hide: (anchor) => setState((current) => (current && current.anchor !== anchor ? current : null)),
      toggle: (anchor, content, placement) =>
        setState((current) => (current?.anchor === anchor ? null : { anchor, content, placement })),
    }),
    [],
  )

  // Reposiciona en cada frame relevante (scroll, resize, cambio de layout) mientras el
  // tooltip esté abierto; se desengancha solo al cerrarse.
  useEffect(() => {
    if (!state) {
      setCoords(null)
      return
    }

    const floating = bubbleRef.current
    if (!floating) {
      return
    }

    return autoUpdate(state.anchor, floating, () => {
      computePosition(state.anchor, floating, {
        strategy: 'fixed',
        placement: state.placement,
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => setCoords({ x, y }))
    })
  }, [state])

  // Tocar en cualquier otro lado cierra el tooltip abierto por tap — el equivalente
  // táctil de "mover el mouse afuera".
  useEffect(() => {
    if (!state) {
      return
    }

    function handlePointerDownOutside(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (state!.anchor.contains(target) || bubbleRef.current?.contains(target)) {
        return
      }
      setState(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setState(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDownOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [state])

  return (
    <TooltipContext.Provider value={controller}>
      {children}
      {state &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            className={`vz-tooltip ${coords ? 'is-visible' : ''}`}
            // Posición en `top`/`left`, no en `transform`: el CSS anima `transform` para el
            // efecto de entrada (escala), y si la posición también viviera ahí, cada
            // reposicionamiento (incluido el primero, desde 0,0) quedaría atrapado en esa
            // misma transición y el tooltip se vería "deslizarse" desde la esquina.
            style={{ position: 'fixed', top: coords?.y ?? 0, left: coords?.x ?? 0 }}
          >
            {state.content}
          </div>,
          document.body,
        )}
    </TooltipContext.Provider>
  )
}

export function useTooltipController(): TooltipContextValue {
  const ctx = useContext(TooltipContext)
  if (!ctx) {
    throw new Error('useTooltipController must be used within a TooltipProvider')
  }
  return ctx
}
