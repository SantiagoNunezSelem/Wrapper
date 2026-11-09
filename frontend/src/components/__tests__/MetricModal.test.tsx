import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { stubIntersectionObserver, stubMatchMedia } from '../../test/setup'
import type { AiCardState, MetricCard, ParticipantProfile } from '../../types'
import type { AiPanelProps } from '../AiStatePanel'
import { MetricModal } from '../MetricModal'
import { TooltipProvider } from '../TooltipProvider'
import type { WordCloudEditor } from '../useEditableWordCloud'

const copy = shellCopy.es

const modalCopy = {
  close: copy.close,
  detailTitle: copy.detailTitle,
  breakdownTitle: copy.breakdownTitle,
  showMore: copy.showMore,
  unlock: copy.unlock,
  searchPlaceholder: copy.searchPlaceholder,
  freeUnlockLoading: copy.freeUnlock.loading,
  wordCloudSearch: copy.wordCloudSearch,
  profiles: copy.profiles,
}

/** Lo mínimo que el modal lee de un editor de nube de palabras que acá no se usa. */
const wordCloudEditor = {
  displayChart: undefined,
  displaySeries: undefined,
  justAddedWord: null,
  searchedWords: [],
  removingWord: null,
  selectedWordForRemoval: null,
  isSearching: false,
  searchError: '',
  searchAndAdd: vi.fn(),
  clearSearchError: vi.fn(),
  onRemoveWord: vi.fn(),
  toggleWordSelection: vi.fn(),
} as unknown as WordCloudEditor

function aiPanel(overrides: Partial<AiPanelProps> = {}): AiPanelProps {
  return {
    copy: copy.ai,
    canRetry: true,
    isBusy: false,
    onRetry: vi.fn(),
    onRetryProfiles: vi.fn(),
    onConsent: vi.fn(),
    ...overrides,
  }
}

function profile(name: string, label: string, source: 'ai' | 'local' = 'ai'): ParticipantProfile {
  return {
    name,
    labelId: 'curioso',
    label,
    summary: `${name} pregunta todo y siempre quiere saber más.`,
    source,
    radar: [
      { axis: 'Presencia', value: 50 },
      { axis: 'Iniciativa', value: 60 },
      { axis: 'Rapidez', value: 70 },
    ],
    messageCount: 300,
  }
}

function card(ai: AiCardState | undefined, overrides: Partial<MetricCard> = {}): MetricCard {
  return {
    id: 'personalidades',
    title: 'La personalidad de cada integrante',
    description: 'Quién es Quién',
    tier: 'vip',
    accent: 'tier-violet',
    hasData: true,
    preview: 'Una personalidad y la razón, para cada integrante del chat.',
    basic: { value: 'Curioso', label: 'la personalidad de Ana, quien más escribe' },
    detail: {
      intro: 'Cada integrante con su personalidad y por qué.',
      profiles: [profile('Ana', 'Curioso'), profile('Beto', 'Seco', 'local')],
    },
    ...(ai ? { ai } : {}),
    ...overrides,
  }
}

function renderModal(data: MetricCard, ai?: AiPanelProps) {
  const onClose = vi.fn()
  render(
    <TooltipProvider>
      <MetricModal
        card={data}
        copy={modalCopy}
        ai={ai}
        wordCloudEditor={wordCloudEditor}
        onClose={onClose}
        onUnlock={vi.fn()}
      />
    </TooltipProvider>,
  )
  return { onClose }
}

beforeEach(() => {
  stubMatchMedia((query) => query.includes('prefers-reduced-motion'))
  stubIntersectionObserver()
})

describe('MetricModal — personalidades', () => {
  it('muestra una ficha por persona con su personalidad y su explicación', () => {
    renderModal(card({ status: 'ready' }), aiPanel())

    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Beto' })).toBeInTheDocument()
    expect(screen.getByText('Ana pregunta todo y siempre quiere saber más.')).toBeInTheDocument()
    expect(screen.getByText('Cada integrante con su personalidad y por qué.')).toBeInTheDocument()
  })

  it('con la IA lista no hay aviso', () => {
    renderModal(card({ status: 'ready' }), aiPanel())

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('si la IA falló, avisa arriba de las fichas y ofrece reintentar solo las personalidades', async () => {
    const panel = aiPanel()
    renderModal(card({ status: 'failed', errorCode: 'quota' }), panel)

    expect(screen.getByRole('status')).toHaveTextContent('La IA no pudo con todos')
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Volver a analizar' }))

    expect(panel.onRetryProfiles).toHaveBeenCalledTimes(1)
    expect(panel.onRetry).not.toHaveBeenCalled()
  })

  it('si esta instalación no tiene IA lo avisa también, sin botón', () => {
    renderModal(card({ status: 'unavailable' }), aiPanel())

    expect(screen.getByRole('status')).toHaveTextContent('Esta instalación todavía no tiene IA configurada.')
    expect(screen.queryByRole('button', { name: 'Volver a analizar' })).not.toBeInTheDocument()
  })

  it('mientras espera a la IA la ficha no se muestra: la lectura local no se hace pasar por la respuesta', () => {
    renderModal(card({ status: 'pending' }, { basic: undefined, detail: undefined }), aiPanel())

    expect(screen.getByText('Estamos armando la personalidad de cada uno. Tarda unos segundos.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ana' })).not.toBeInTheDocument()
  })

  it('quien no es Pro ve la tarjeta cerrada, sin fichas ni aviso', () => {
    renderModal(card({ status: 'pending' }, { basic: undefined, detail: undefined }))

    expect(screen.queryByRole('heading', { name: 'Ana' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('una tarjeta sin fichas no rompe el detalle', () => {
    renderModal(card({ status: 'ready' }, { detail: { intro: 'Sin datos.' } }), aiPanel())

    expect(screen.getByText('Sin datos.')).toBeInTheDocument()
  })
})
