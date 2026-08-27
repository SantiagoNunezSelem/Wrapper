import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModalShell } from '../ModalShell'
import { TooltipProvider } from '../TooltipProvider'

/** La × de la esquina es un `CrossButton`, que lleva Tooltip: sin el proveedor
 * de la app, montarlo suelto explota. */
function renderModal(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('ModalShell', () => {
  it('se anuncia como diálogo', () => {
    renderModal(
      <ModalShell onDismiss={vi.fn()} label="Detalle de la métrica" closeLabel="Cerrar">
        <p>contenido</p>
      </ModalShell>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Detalle de la métrica' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('cierra con Escape', async () => {
    const onDismiss = vi.fn()
    renderModal(
      <ModalShell onDismiss={onDismiss} label="Diálogo" closeLabel="Cerrar">
        <button type="button">adentro</button>
      </ModalShell>,
    )

    await userEvent.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('cierra al tocar el fondo, pero no al tocar la tarjeta', async () => {
    const onDismiss = vi.fn()
    renderModal(
      <ModalShell onDismiss={onDismiss} label="Diálogo" closeLabel="Cerrar">
        <p>contenido</p>
      </ModalShell>,
    )

    await userEvent.click(screen.getByText('contenido'))
    expect(onDismiss).not.toHaveBeenCalled()

    await userEvent.click(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('bloquea el scroll del fondo mientras está abierto y lo devuelve al cerrar', () => {
    const { unmount } = renderModal(
      <ModalShell onDismiss={vi.fn()} label="Diálogo" closeLabel="Cerrar">
        <p>contenido</p>
      </ModalShell>,
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('con dos capas apiladas, el scroll sigue bloqueado hasta que se cierran las dos', () => {
    const first = renderModal(
      <ModalShell onDismiss={vi.fn()} label="Uno" closeLabel="Cerrar">
        <p>uno</p>
      </ModalShell>,
    )
    const second = renderModal(
      <ModalShell onDismiss={vi.fn()} label="Dos" closeLabel="Cerrar">
        <p>dos</p>
      </ModalShell>,
    )

    second.unmount()
    expect(document.body.style.overflow).toBe('hidden')

    first.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('Escape cierra sólo la capa de arriba', async () => {
    const onDismissBottom = vi.fn()
    const onDismissTop = vi.fn()

    renderModal(
      <ModalShell onDismiss={onDismissBottom} label="Abajo" closeLabel="Cerrar">
        <p>abajo</p>
      </ModalShell>,
    )
    renderModal(
      <ModalShell onDismiss={onDismissTop} label="Arriba" closeLabel="Cerrar">
        <p>arriba</p>
      </ModalShell>,
    )

    await userEvent.keyboard('{Escape}')

    expect(onDismissTop).toHaveBeenCalledTimes(1)
    expect(onDismissBottom).not.toHaveBeenCalled()
  })

  it('lleva el foco adentro al abrirse', () => {
    renderModal(
      <ModalShell onDismiss={vi.fn()} label="Diálogo" closeLabel="Cerrar">
        <button type="button">adentro</button>
      </ModalShell>,
    )

    // El primero enfocable es la × de la esquina, que ModalShell dibuja antes
    // que el contenido.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }))
  })

  it('devuelve el foco a quien lo tenía cuando se cierra', async () => {
    renderModal(
      <button type="button" data-testid="trigger">
        abrir
      </button>,
    )
    const trigger = screen.getByTestId('trigger')
    trigger.focus()

    const modal = renderModal(
      <ModalShell onDismiss={vi.fn()} label="Diálogo" closeLabel="Cerrar">
        <button type="button">adentro</button>
      </ModalShell>,
    )
    expect(document.activeElement).not.toBe(trigger)

    modal.unmount()
    expect(document.activeElement).toBe(trigger)
  })

  it('el Tab da la vuelta adentro del diálogo en vez de salirse a la página', async () => {
    renderModal(
      <button type="button" data-testid="fuera">
        afuera
      </button>,
    )
    renderModal(
      <ModalShell onDismiss={vi.fn()} label="Diálogo" closeLabel="Cerrar">
        <button type="button">primero</button>
        <button type="button">último</button>
      </ModalShell>,
    )

    const close = screen.getByRole('button', { name: 'Cerrar' })
    const last = screen.getByRole('button', { name: 'último' })

    await userEvent.tab()
    await userEvent.tab()
    expect(document.activeElement).toBe(last)

    // Un Tab más tendría que volver al principio del diálogo, no llegar nunca al
    // botón que quedó afuera.
    await userEvent.tab()
    expect(document.activeElement).toBe(close)

    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(last)
  })
})
