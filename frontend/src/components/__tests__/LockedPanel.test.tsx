import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LockedPanel } from '../LockedPanel'

const base = {
  preview: 'Reparto por integrante y cómo cambió mes a mes.',
  unlockLabel: 'Desbloquear con Pro',
  onUnlock: vi.fn(),
}

describe('LockedPanel', () => {
  it('muestra el teaser y el botón de Pro', () => {
    render(<LockedPanel {...base} onUnlock={vi.fn()} />)

    expect(screen.getByText(base.preview)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desbloquear con Pro' })).toBeInTheDocument()
  })

  it('el botón de Pro dispara onUnlock', async () => {
    const onUnlock = vi.fn()
    render(<LockedPanel {...base} onUnlock={onUnlock} />)

    await userEvent.click(screen.getByRole('button', { name: 'Desbloquear con Pro' }))

    expect(onUnlock).toHaveBeenCalledTimes(1)
  })

  it('con desbloqueos gratis disponibles ofrece ESE botón, no el de Pro', async () => {
    const onUse = vi.fn()
    const onUnlock = vi.fn()
    render(
      <LockedPanel
        {...base}
        onUnlock={onUnlock}
        freeUnlock={{ label: 'Usar 1 de 5 gratis', waitNote: null, onUse }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Desbloquear con Pro' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Usar 1 de 5 gratis' }))

    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('nunca muestra los dos botones a la vez', () => {
    render(
      <LockedPanel
        {...base}
        onUnlock={vi.fn()}
        freeUnlock={{ label: 'Usar 1 de 5 gratis', waitNote: null, onUse: vi.fn() }}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('agotados los gratis vuelve al botón de Pro y explica la espera', () => {
    render(
      <LockedPanel
        {...base}
        onUnlock={vi.fn()}
        freeUnlock={{ label: 'Sin desbloqueos', waitNote: 'Vuelven en 4h 12m', onUse: null }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Desbloquear con Pro' })).toBeInTheDocument()
    expect(screen.getByText('Vuelven en 4h 12m')).toBeInTheDocument()
  })

  it('mientras revela muestra el spinner y esconde los botones', () => {
    render(<LockedPanel {...base} onUnlock={vi.fn()} isRevealing revealingLabel="Desbloqueando…" />)

    expect(screen.getByText('Desbloqueando…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(base.preview)).not.toBeInTheDocument()
  })

  it('la variante alta agrega más barras de esqueleto', () => {
    const { rerender } = render(<LockedPanel {...base} onUnlock={vi.fn()} />)
    const short = document.querySelectorAll('.skeleton-bar').length

    rerender(<LockedPanel {...base} onUnlock={vi.fn()} tall />)

    expect(document.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(short)
    expect(document.querySelector('.locked-panel')).toHaveClass('is-tall')
  })
})
