import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiCardState } from '../../types'
import { AiFallbackNotice, AiStatePanel, type AiPanelProps } from '../AiStatePanel'

function panel(overrides: Partial<AiPanelProps> = {}): AiPanelProps {
  return {
    copy: {
      failedTitle: 'No se pudo analizar',
      reasons: { quota: 'Se acabó la cuota por hoy.', default: 'Algo falló.' },
      retry: 'Reintentar',
      retryIn: 'Reintentar en {time}',
      retrying: 'Reintentando…',
      needsUpload: 'Volvé a subir el chat',
      consentTitle: 'Falta tu permiso',
      consentBody: 'Autorizá el análisis de las métricas.',
      consentBodyProfiles: 'Autorizá la IA para ver las personalidades.',
      consentCta: 'Autorizar',
      unavailableTitle: 'No disponible',
      unavailableBody: 'Esta instalación no tiene IA configurada.',
      pendingTitle: 'Analizando',
      pendingBody: 'La IA está revisando los mensajes.',
      pendingBodyProfiles: 'La IA está armando las personalidades.',
      fallbackTitle: 'La IA no pudo con todos',
      fallbackBody: 'Mostramos un análisis local.',
      fallbackUnavailable: 'Esta instalación no tiene IA.',
      fallbackBadge: 'Análisis local',
    },
    canRetry: true,
    isBusy: false,
    onRetry: vi.fn(),
    onRetryProfiles: vi.fn(),
    onConsent: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AiStatePanel — el texto según para qué tarjeta es', () => {
  it('pide el permiso con el texto de las métricas o con el de las personalidades', () => {
    const { rerender } = render(<AiStatePanel state={{ status: 'consent' }} {...panel()} />)
    expect(screen.getByText('Autorizá el análisis de las métricas.')).toBeInTheDocument()

    rerender(<AiStatePanel state={{ status: 'consent' }} {...panel()} forProfiles />)
    expect(screen.getByText('Autorizá la IA para ver las personalidades.')).toBeInTheDocument()
  })

  it('cuenta que se está analizando con el texto que corresponde', () => {
    const { rerender } = render(<AiStatePanel state={{ status: 'pending' }} {...panel()} />)
    expect(screen.getByText('La IA está revisando los mensajes.')).toBeInTheDocument()

    rerender(<AiStatePanel state={{ status: 'pending' }} {...panel()} forProfiles />)
    expect(screen.getByText('La IA está armando las personalidades.')).toBeInTheDocument()
  })
})

describe('AiFallbackNotice', () => {
  const failed: AiCardState = { status: 'failed', errorCode: 'quota', retryAvailableAtUtc: null }

  it('dice qué pasó y qué se está mostrando en su lugar', () => {
    render(<AiFallbackNotice state={failed} {...panel()} />)

    expect(screen.getByRole('status')).toHaveTextContent('La IA no pudo con todos')
    expect(screen.getByRole('status')).toHaveTextContent('Se acabó la cuota por hoy. Mostramos un análisis local.')
  })

  it('un motivo que no conoce cae en el genérico', () => {
    render(<AiFallbackNotice state={{ status: 'failed', errorCode: 'rara' }} {...panel()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Algo falló.')
  })

  it('sin código de error usa el genérico', () => {
    render(<AiFallbackNotice state={{ status: 'failed' }} {...panel()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Algo falló.')
  })

  it('ofrece reintentar, y el reintento es el de las personalidades', async () => {
    const props = panel()
    render(<AiFallbackNotice state={failed} {...props} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(props.onRetryProfiles).toHaveBeenCalledTimes(1)
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('mientras reintenta lo dice y no deja apretar de nuevo', () => {
    render(<AiFallbackNotice state={failed} {...panel({ isBusy: true })} />)

    expect(screen.getByRole('button', { name: 'Reintentando…' })).toBeDisabled()
  })

  it('si el chat ya no está en memoria pide subirlo de nuevo', () => {
    render(<AiFallbackNotice state={failed} {...panel({ canRetry: false })} />)

    expect(screen.getByRole('button', { name: 'Volvé a subir el chat' })).toBeEnabled()
  })

  it('en el enfriamiento el botón queda apagado y se ve cuánto falta', () => {
    const retryAvailableAtUtc = new Date(Date.now() + 90_000).toISOString()
    render(<AiFallbackNotice state={{ status: 'failed', errorCode: 'quota', retryAvailableAtUtc }} {...panel()} />)

    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled()
    expect(screen.getByText(/Reintentar en/)).toBeInTheDocument()
  })

  it('si la instalación no tiene IA lo dice y no ofrece reintentar nada', () => {
    render(<AiFallbackNotice state={{ status: 'unavailable' }} {...panel()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Esta instalación no tiene IA. Mostramos un análisis local.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
