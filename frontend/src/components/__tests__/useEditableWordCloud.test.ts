import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { chat } from '../../test/fixtures'
import type { ChartData } from '../../types'
import { useEditableWordCloud, type WordCloudSearchCopy } from '../useEditableWordCloud'

const copy: WordCloudSearchCopy = {
  emptyQuery: 'vacío',
  alreadyShown: 'ya está',
  notFound: 'no aparece',
  noAccess: 'sin acceso',
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

describe('useEditableWordCloud — agregar por búsqueda', () => {
  it('agrega una palabra real del chat que no estaba en la nube', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.searchAndAdd('finde')
    })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo', 'finde'])
    expect(result.current.searchError).toBe('')
  })

  it('rechaza una búsqueda vacía sin tocar la nube', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.searchAndAdd('   ')
    })

    expect(result.current.searchError).toBe(copy.emptyQuery)
    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })

  it('rechaza una palabra que ya está visible en la nube', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.searchAndAdd('pizza')
    })

    expect(result.current.searchError).toBe(copy.alreadyShown)
  })

  it('rechaza una palabra que nunca aparece en el chat', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.searchAndAdd('inexistente')
    })

    expect(result.current.searchError).toBe(copy.notFound)
    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })

  it('sin mensajes crudos (historial guardado, historia compartida) avisa que no hay acceso', () => {
    const { result } = renderHook(() =>
      useEditableWordCloud({ chart: baseChart, messages: undefined, resetKey: 'wordcloud', copy }),
    )

    act(() => {
      result.current.searchAndAdd('finde')
    })

    expect(result.current.searchError).toBe(copy.noAccess)
  })
})

describe('useEditableWordCloud — borrar', () => {
  it('clickear y luego borrar saca la palabra de la nube', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.onWordClick('pizza')
    })
    expect(result.current.selectedWord).toBe('pizza')

    act(() => {
      result.current.onRemoveWord('pizza')
    })

    expect(words(result.current.displayChart)).toEqual(['laburo'])
    expect(result.current.selectedWord).toBeNull()
  })

  it('borrar una palabra agregada por búsqueda también la saca', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => {
      result.current.searchAndAdd('finde')
    })
    act(() => {
      result.current.onRemoveWord('finde')
    })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
  })

  it('clickear la misma palabra dos veces la deselecciona', () => {
    const { result } = renderHook(() => useEditableWordCloud({ chart: baseChart, messages, resetKey: 'wordcloud', copy }))

    act(() => result.current.onWordClick('pizza'))
    act(() => result.current.onWordClick('pizza'))

    expect(result.current.selectedWord).toBeNull()
  })
})

describe('useEditableWordCloud — reinicio entre métricas', () => {
  it('cambiar resetKey borra lo agregado, lo removido y la selección', () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useEditableWordCloud({ chart: baseChart, messages, resetKey, copy }),
      { initialProps: { resetKey: 'wordcloud' } },
    )

    act(() => {
      result.current.searchAndAdd('finde')
      result.current.onWordClick('laburo')
    })
    expect(words(result.current.displayChart)).toContain('finde')

    rerender({ resetKey: 'other-metric' })

    expect(words(result.current.displayChart)).toEqual(['pizza', 'laburo'])
    expect(result.current.selectedWord).toBeNull()
  })
})
