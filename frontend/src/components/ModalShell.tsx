import type { ReactNode } from 'react'
import { CrossButton } from './IconButton'
import { useModalDismiss } from './useModalDismiss'

/**
 * El envoltorio de todos los modales de desktop: fondo, tarjeta, botón de cerrar
 * y —vía `useModalDismiss`— Escape, bloqueo del scroll de fondo y trampa de foco.
 *
 * Antes cada modal repetía el mismo `<div className="modal-backdrop">` con su
 * `stopPropagation`, y ninguno traía nada de lo otro: se scrolleaba la página
 * tapada, Escape no hacía nada y el foco se quedaba afuera. Con un solo lugar,
 * agregar un modal nuevo ya no puede olvidarse de ninguna de esas tres cosas.
 */
export function ModalShell({
  onDismiss,
  label,
  className = '',
  closeLabel,
  children,
}: {
  onDismiss: () => void
  /** Cómo se anuncia el diálogo. Cuando la tarjeta ya trae un `<h2>` propio, este
   * es el mismo texto. */
  label: string
  className?: string
  /** Omitirlo deja la tarjeta sin la × de la esquina, para los modales que ponen
   * su propio cierre adentro del contenido. */
  closeLabel?: string
  children: ReactNode
}) {
  const panelRef = useModalDismiss<HTMLElement>(onDismiss)

  return (
    <div className="modal-backdrop" role="presentation" onClick={onDismiss}>
      <section
        ref={panelRef}
        className={`modal-card ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {closeLabel ? <CrossButton label={closeLabel} onClick={onDismiss} className="close-button" /> : null}
        {children}
      </section>
    </div>
  )
}
