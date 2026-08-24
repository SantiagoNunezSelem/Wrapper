import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubIntersectionObserver, stubMatchMedia } from '../../test/setup'
import type { AiCardState, MetricCard as MetricCardData } from '../../types'
import type { AiPanelProps } from '../AiStatePanel'
import { MetricCard } from '../MetricCard'

function card(overrides: Partial<MetricCardData> = {}): MetricCardData {
  return {
    id: 'spammer',
    title: 'Quién manda más mensajes',
    description: 'El Spammer vs El Silencioso',
    tier: 'free',
    accent: 'tier-purple',
    hasData: true,
    preview: 'Reparto por integrante y cómo cambió mes a mes.',
    basic: {
      value: '70.0%',
      label: 'de los mensajes son de Ana',
      chart: { kind: 'bar', items: [{ label: 'Ana', value: 7, displayValue: '70.0%' }] },
    },
    ...overrides,
  }
}

const aiPanel: AiPanelProps = {
  copy: {
    failedTitle: 'No se pudo analizar',
    reasons: { quota: 'Se acabó la cuota por hoy.', default: 'Algo falló.' },
    retry: 'Reintentar',
    retryIn: 'Reintentar en {time}',
    retrying: 'Reintentando…',
    needsUpload: 'Volvé a subir el chat',
    consentTitle: 'Falta tu permiso',
    consentBody: 'Necesitamos que autorices el análisis.',
    consentCta: 'Autorizar',
    unavailableTitle: 'No disponible',
    unavailableBody: 'Esta instalación no tiene IA configurada.',
    pendingTitle: 'Analizando',
    pendingBody: 'La IA está revisando los mensajes.',
  },
  canRetry: true,
  isBusy: false,
  onRetry: vi.fn(),
  onConsent: vi.fn(),
}

function renderCard(data: MetricCardData, extra: Partial<Parameters<typeof MetricCard>[0]> = {}) {
  return render(
    <MetricCard
      card={data}
      seeMoreLabel="Ver más"
      unlockLabel="Desbloquear con Pro"
      onOpen={vi.fn()}
      onUnlock={vi.fn()}
      {...extra}
    />,
  )
}

beforeEach(() => {
  // Sin animación de conteo, el número se muestra directo y las aserciones son estables.
  stubMatchMedia((query) => query.includes('prefers-reduced-motion'))
  stubIntersectionObserver()
})

describe('MetricCard — tarjeta abierta', () => {
  it('muestra título, apodo, número y etiqueta', () => {
    renderCard(card())

    expect(screen.getByRole('heading', { name: 'Quién manda más mensajes' })).toBeInTheDocument()
    expect(screen.getByText('El Spammer vs El Silencioso')).toBeInTheDocument()
    // Acotado al stat: el mismo "70.0%" también aparece como etiqueta de la barra.
    expect(document.querySelector('.metric-stat strong')).toHaveTextContent('70.0%')
    expect(screen.getByText('de los mensajes son de Ana')).toBeInTheDocument()
  })

  it('muestra la nota literal sólo si la tarjeta la trae', () => {
    const { rerender } = renderCard(card())
    expect(document.querySelector('.metric-note')).toBeNull()

    rerender(
      <MetricCard
        card={card({ basic: { value: '1.240', label: 'caracteres', note: '"che mirá esto"' } })}
        seeMoreLabel="Ver más"
        unlockLabel="Desbloquear con Pro"
        onOpen={vi.fn()}
        onUnlock={vi.fn()}
      />,
    )

    expect(screen.getByText('"che mirá esto"')).toBeInTheDocument()
  })

  it('"Ver más" entrega la tarjeta completa', async () => {
    const onOpen = vi.fn()
    const data = card()
    renderCard(data, { onOpen })

    await userEvent.click(screen.getByRole('button', { name: 'Ver más' }))

    expect(onOpen).toHaveBeenCalledWith(data)
  })

  it('no marca como bloqueada una tarjeta con datos', () => {
    renderCard(card())

    expect(document.querySelector('.metric-card')).not.toHaveClass('is-locked')
  })

  it('sólo las tarjetas Pro llevan corona', () => {
    const { rerender } = renderCard(card({ tier: 'free' }))
    expect(document.querySelector('.metric-tier-dot')).toBeNull()

    rerender(
      <MetricCard
        card={card({ tier: 'vip' })}
        seeMoreLabel="Ver más"
        unlockLabel="Desbloquear con Pro"
        onOpen={vi.fn()}
        onUnlock={vi.fn()}
      />,
    )

    expect(document.querySelector('.metric-tier-dot')).toHaveClass('is-unlocked')
  })
})

describe('MetricCard — tarjeta bloqueada', () => {
  const locked = card({ tier: 'vip', basic: undefined })

  it('muestra el teaser en lugar del número', () => {
    renderCard(locked)

    expect(screen.getByText(locked.preview)).toBeInTheDocument()
    expect(screen.queryByText('70.0%')).not.toBeInTheDocument()
    expect(document.querySelector('.metric-card')).toHaveClass('is-locked')
  })

  it('la corona aparece cerrada', () => {
    renderCard(locked)

    expect(document.querySelector('.metric-tier-dot')).toHaveClass('is-locked')
  })

  it('el botón de desbloquear dispara onUnlock', async () => {
    const onUnlock = vi.fn()
    renderCard(locked, { onUnlock })

    await userEvent.click(screen.getByRole('button', { name: 'Desbloquear con Pro' }))

    expect(onUnlock).toHaveBeenCalledTimes(1)
  })

  it('"Ver más" sigue disponible en una tarjeta bloqueada', () => {
    renderCard(locked)

    expect(screen.getByRole('button', { name: 'Ver más' })).toBeInTheDocument()
  })
})

describe('MetricCard — métrica con IA', () => {
  function aiCard(ai: AiCardState) {
    return card({ id: 'redflags', tier: 'vip', ai, basic: { value: '73/100', label: 'tensión' } })
  }

  it.each<[AiCardState['status'], string]>([
    ['pending', 'Analizando'],
    ['consent', 'Falta tu permiso'],
    ['unavailable', 'No disponible'],
    ['failed', 'No se pudo analizar'],
  ])('en estado "%s" muestra su propio panel', (status, title) => {
    renderCard(aiCard({ status }), { ai: aiPanel })

    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it('sin veredicto NUNCA muestra el número crudo del diccionario', () => {
    renderCard(aiCard({ status: 'pending' }), { ai: aiPanel })

    expect(screen.queryByText('73/100')).not.toBeInTheDocument()
  })

  it('con veredicto listo se comporta como cualquier tarjeta abierta', () => {
    renderCard(aiCard({ status: 'ready' }), { ai: aiPanel })

    expect(screen.getByText('73/100')).toBeInTheDocument()
    expect(screen.queryByText('Analizando')).not.toBeInTheDocument()
  })

  it('un fallo con código conocido explica el motivo real', () => {
    renderCard(aiCard({ status: 'failed', errorCode: 'quota' }), { ai: aiPanel })

    expect(screen.getByText('Se acabó la cuota por hoy.')).toBeInTheDocument()
  })

  it('un código desconocido cae en el mensaje genérico', () => {
    renderCard(aiCard({ status: 'failed', errorCode: 'algo-nuevo' }), { ai: aiPanel })

    expect(screen.getByText('Algo falló.')).toBeInTheDocument()
  })

  it('el botón reintenta', async () => {
    const onRetry = vi.fn()
    renderCard(aiCard({ status: 'failed' }), { ai: { ...aiPanel, onRetry } })

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('sin el chat en memoria el botón pide volver a subirlo', () => {
    renderCard(aiCard({ status: 'failed' }), { ai: { ...aiPanel, canRetry: false } })

    expect(screen.getByRole('button', { name: 'Volvé a subir el chat' })).toBeInTheDocument()
  })

  it('durante el reintento el botón queda deshabilitado', () => {
    renderCard(aiCard({ status: 'failed' }), { ai: { ...aiPanel, isBusy: true } })

    expect(screen.getByRole('button', { name: 'Reintentando…' })).toBeDisabled()
  })

  it('durante el enfriamiento deshabilita el botón y muestra la cuenta regresiva', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-10T10:00:00Z'))
    try {
      renderCard(
        aiCard({ status: 'failed', retryAvailableAtUtc: '2025-03-10T10:02:00Z' }),
        { ai: aiPanel },
      )

      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled()
      expect(screen.getByText('Reintentar en 2:00')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin panel de IA (viewer sin Pro) se muestra el upsell común', () => {
    renderCard(aiCard({ status: 'pending' }))

    expect(screen.queryByText('Analizando')).not.toBeInTheDocument()
    expect(screen.getByText('73/100')).toBeInTheDocument()
  })

  it('el consentimiento se puede autorizar desde la tarjeta', async () => {
    const onConsent = vi.fn()
    renderCard(aiCard({ status: 'consent' }), { ai: { ...aiPanel, onConsent } })

    await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }))

    expect(onConsent).toHaveBeenCalledTimes(1)
  })
})
