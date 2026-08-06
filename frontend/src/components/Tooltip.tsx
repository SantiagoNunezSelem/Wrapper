import { cloneElement, type ReactElement, type ReactNode } from 'react'
import type { Placement } from '@floating-ui/dom'
import { useTooltipController } from './TooltipProvider'

type TriggerProps = {
  onPointerEnter?: (event: React.PointerEvent) => void
  onPointerLeave?: (event: React.PointerEvent) => void
  onPointerDown?: (event: React.PointerEvent) => void
  onFocus?: (event: React.FocusEvent) => void
  onBlur?: (event: React.FocusEvent) => void
}

/**
 * Reemplazo propio del `title` nativo del navegador: mismo gesto (hover, foco),
 * cero delay de un segundo, y con el look de Vistazo en vez del cuadrito gris
 * del sistema operativo.
 *
 * `children` tiene que ser un único elemento — se le clonan los manejadores de
 * puntero/foco encima de los que ya tuviera, así que envolver un botón o un
 * span existente no le pisa su propio onClick.
 *
 * En mouse/teclado aparece con el hover o el foco. En touch no hay hover, así
 * que un tap alcanza-y-cierra (toggle) el mismo tooltip: es la única forma de
 * llegar a este texto desde un teléfono.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  disabled = false,
  getAnchor,
}: {
  content: ReactNode
  children: ReactElement<TriggerProps>
  placement?: Placement
  disabled?: boolean
  /** Positions the bubble against a different element than the one that triggered
   * it — e.g. a large, easy-to-hit pointer target that isn't where the bubble
   * should visually anchor (see ActivityWave, whose full-height hit column would
   * otherwise put `placement="top"` above the whole chart instead of by the
   * hovered point on the curve). Called fresh on every pointer/focus event
   * instead of taking a ref directly, since the real anchor node (e.g. one point
   * on a curve) may not exist yet on the render that wires up this handler.
   * Falls back to the trigger element itself when omitted or it returns null. */
  getAnchor?: () => Element | null
}) {
  const { show, hide, toggle } = useTooltipController()

  if (disabled || content == null || content === '') {
    return children
  }

  const childProps = children.props
  const resolveAnchor = (event: { currentTarget: EventTarget }) =>
    (getAnchor?.() as HTMLElement | null) ?? (event.currentTarget as HTMLElement)

  return cloneElement(children, {
    onPointerEnter: (event: React.PointerEvent) => {
      childProps.onPointerEnter?.(event)
      if (event.pointerType === 'mouse') {
        show(resolveAnchor(event), content, placement)
      }
    },
    onPointerLeave: (event: React.PointerEvent) => {
      childProps.onPointerLeave?.(event)
      if (event.pointerType === 'mouse') {
        hide(resolveAnchor(event))
      }
    },
    onPointerDown: (event: React.PointerEvent) => {
      childProps.onPointerDown?.(event)
      if (event.pointerType !== 'mouse') {
        toggle(resolveAnchor(event), content, placement)
      }
    },
    onFocus: (event: React.FocusEvent) => {
      childProps.onFocus?.(event)
      show(resolveAnchor(event), content, placement)
    },
    onBlur: (event: React.FocusEvent) => {
      childProps.onBlur?.(event)
      hide(resolveAnchor(event))
    },
  } as TriggerProps)
}
