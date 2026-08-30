import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerResponse } from '../../lib/analysisWorker'
import { countWordOccurrences } from '../../lib/metrics'
import { chat } from '../../test/fixtures'
import type { ChartData, MetricSeriesEntry } from '../../types'
import { useEditableWordCloud, type WordCloudSearchCopy } from '../useEditableWordCloud'

/** Doble del `Worker` del navegador — jsdom no lo implementa (ver analysisClient.test.ts,
 * que prueba el protocolo de mensajes en sí). Acá alcanza con responder solo, calculando
 * con la función real: lo que estos tests verifican es el comportamiento del hook
 * (deduplicación, propagación por integrante, errores), no el transporte. */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null

  postMessage(message: WorkerRequest) {
    if (message.type !== 'wordSearch') {
      return
    }
    const count = countWordOccurrences(message.messages, message.query)
    const countsByParticipant: Record<string, number> = {}
    for (const name of message.participants) {
      const personMessages = message.messages.filter((item) => item.sender === name)
      countsByParticipant[name] = countWordOccurrences(personMessages, message.query)
    }
    this.onmessage?.({
      data: { requestId: message.requestId, type: 'wordSearch', count, countsByParticipant },
    } as MessageEvent<WorkerResponse>)
  }

  terminate() {}
}

/** Coincide con REMOVE_DELAY_MS del hook — no se importa a propósito, para que este
 * archivo pruebe el tiempo real que el hook expone (mismo criterio que PAST_THE_END
 * en useCountUp.test.tsx). */
const REMOVE_DELAY_MS = 350

const copy: WordCloudSearchCopy = {
  emptyQuery: 'vacío',
  alreadyShown: 'ya está',
  notFound: 'no aparece',
  noAccess: 'sin acceso',
  searchFailed: 'falló la búsqueda',
}

const baseChart: ChartData = {
  kind: 'wordCloud',
  words: [
    { word: 'pizza', count: 5 },
    { word: 'laburo', count: 3 },
  ],
}

const messages = chat(
  { at: '2025-03-10T10:00:00', from: 'Ana', text: 'finde finde finde' },
  { at: '2025-03-10T10:01:00', from: 'Beto', text: 'que finde' },
)

function words(chart: ChartData | undefined): string[] {
  if (chart?.kind !== 'wordCloud') {
    return []
  }
  return chart.words.map((entry) => entry.word)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useEditableWordCloud — agregar por búsqueda', () => {
  it('agrega una palabra real del chat que no estaba en la nube', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo', 'finde'])
    expect(result.current.searchError).toBe('')
  })

  it('marca isSearching mientras espera al worker, y lo baja al terminar', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.searchAndAdd('finde')
    })
    expect(result.current.isSearching).toBe(true)

    await act(async () => {
      await pending
    })
    expect(result.current.isSearching).toBe(false)
  })

  it('marca la palabra agregada como la recién agregada', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    expect(result.current.justAddedWord).toBeNull()

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    expect(result.current.justAddedWord).toBe('finde')
  })

  it('rechaza una búsqueda vacía sin tocar la nube ni consultar al worker', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('   ')
    })

    expect(result.current.searchError).toBe(copy.emptyQuery)
    expect(result.current.isSearching).toBe(false)
    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })

  it('rechaza una palabra que ya está visible en la nube', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('pizza')
    })

    expect(result.current.searchError).toBe(copy.alreadyShown)
  })

  it('rechaza una palabra que nunca aparece en el chat', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('inexistente')
    })

    expect(result.current.searchError).toBe(copy.notFound)
    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })

  it('sin mensajes crudos (historial guardado, historia compartida) avisa que no hay acceso', async () => {
    const { result } = renderHook(() =>
      useEditableWordCloud({ chart: baseChart, messages: undefined, resetKey: 'wordcloud', copy }),
    )

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    expect(result.current.searchError).toBe(copy.noAccess)
  })

  it('si el worker falla, avisa en vez de dejar la búsqueda colgada', async () => {
    // `analysisClient.ts` cachea el Worker una sola vez a nivel de módulo (ver su
    // comentario "One worker for the app's whole lifetime"), y ya se creó un
    // FakeWorker sano en un test anterior — resetear módulos y reimportar el hook
    // es la única forma de que el próximo `getWorker()` construya uno nuevo con
    // este stub roto en vez de reusar el que ya está andando bien.
    vi.resetModules()
    class BrokenWorker extends FakeWorker {
      postMessage(): void {
        throw new Error('crashed')
      }
    }
    vi.stubGlobal('Worker', BrokenWorker)
    const fresh = await import('../useEditableWordCloud')

    const { result } = renderHook(() => fresh.useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    expect(result.current.searchError).toBe(copy.searchFailed)
    expect(result.current.isSearching).toBe(false)
  })
})

describe('useEditableWordCloud — borrar', () => {
  it('marca removingWord y muestra un spinner hasta que se cumple el delay', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    let pending!: Promise<void>
    act(() => {
      pending = result.current.onRemoveWord('pizza')
    })
    expect(result.current.removingWord).toBe('pizza')
    // Todavía no se cumplió el delay: la palabra sigue en la nube.
    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])

    await act(async () => {
      vi.advanceTimersByTime(REMOVE_DELAY_MS)
      await pending
    })

    expect(result.current.removingWord).toBeNull()
    expect(words(result.current.displayChart)).toEqual(['laburo'])
  })

  it('borrar una palabra agregada por búsqueda también la saca', async () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })
    await act(async () => {
      const pending = result.current.onRemoveWord('finde')
      vi.advanceTimersByTime(REMOVE_DELAY_MS)
      await pending
    })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })
})

describe('useEditableWordCloud — se replica por integrante', () => {
  const series: MetricSeriesEntry[] = [
    { name: 'Ana', chart: { kind: 'wordCloud', words: [{ word: 'pizza', count: 5 }] } },
    { name: 'Beto', chart: { kind: 'wordCloud', words: [{ word: 'laburo', count: 2 }] } },
  ]

  it('agrega la palabra a cada nube por integrante, con el conteo propio de cada uno', async () => {
    const { result } = renderHook(() =>
      useEditableWordCloud({ chart: baseChart, series, messages, resetKey: 'wordcloud', copy }),
    )

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    const ana = result.current.displaySeries?.find((entry) => entry.name === 'Ana')
    const beto = result.current.displaySeries?.find((entry) => entry.name === 'Beto')

    expect(words(ana?.chart)).toEqual(['pizza', 'finde'])
    expect(ana?.chart.kind === 'wordCloud' && ana.chart.words.find((w) => w.word === 'finde')?.count).toBe(3)

    expect(words(beto?.chart)).toEqual(['laburo', 'finde'])
    expect(beto?.chart.kind === 'wordCloud' && beto.chart.words.find((w) => w.word === 'finde')?.count).toBe(1)
  })

  it('no duplica la palabra si ese integrante ya la tenía en su propia nube', async () => {
    const seriesWithOverlap: MetricSeriesEntry[] = [
      { name: 'Ana', chart: { kind: 'wordCloud', words: [{ word: 'finde', count: 9 }] } },
    ]
    const { result } = renderHook(() =>
      useEditableWordCloud({ chart: baseChart, series: seriesWithOverlap, messages, resetKey: 'wordcloud', copy }),
    )

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })

    const ana = result.current.displaySeries?.find((entry) => entry.name === 'Ana')
    expect(words(ana?.chart)).toEqual(['finde'])
  })

  it('borrar la palabra desde la nube principal también la saca de cada integrante', async () => {
    const { result } = renderHook(() =>
      useEditableWordCloud({ chart: baseChart, series, messages, resetKey: 'wordcloud', copy }),
    )

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })
    await act(async () => {
      const pending = result.current.onRemoveWord('finde')
      vi.advanceTimersByTime(REMOVE_DELAY_MS)
      await pending
    })

    const ana = result.current.displaySeries?.find((entry) => entry.name === 'Ana')
    const beto = result.current.displaySeries?.find((entry) => entry.name === 'Beto')
    expect(words(ana?.chart)).toEqual(['pizza'])
    expect(words(beto?.chart)).toEqual(['laburo'])
  })
})

describe('useEditableWordCloud — reinicio entre métricas', () => {
  it('cambiar resetKey borra lo agregado, lo removido y la palabra recién agregada', async () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useEditableWordCloud({ chart: baseChart, messages, resetKey, copy }),
      { initialProps: { resetKey: 'wordcloud' } },
    )

    await act(async () => {
      await result.current.searchAndAdd('finde')
    })
    expect(words(result.current.displayChart)).toContain('finde')

    rerender({ resetKey: 'other-metric' })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
    expect(result.current.justAddedWord).toBeNull()
  })
})
