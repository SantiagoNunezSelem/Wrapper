import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../TooltipProvider'
import { WordCloud } from '../WordCloud'

const words = [
  { word: 'pizza', count: 12 },
  { word: 'laburo', count: 7 },
]

/** WordCloud no guarda el toggle de selección: lo recibe de quien la usa (ver
 * useEditableWordCloud.toggleWordSelection). Este wrapper hace ese papel, igual
 * que lo hacen MetricModal/MetricSheet en la app real. */
function ControlledCloud(props: Partial<Parameters<typeof WordCloud>[0]>) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <WordCloud
      words={words}
      {...props}
      selectedWordForRemoval={selected}
      onToggleSelection={(word) => setSelected((current) => (current === word ? null : word))}
    />
  )
}

function renderCloud(extra: Partial<Parameters<typeof WordCloud>[0]> = {}) {
  return render(
    <TooltipProvider>
      <ControlledCloud {...extra} />
    </TooltipProvider>,
  )
}

describe('WordCloud — modo lectura', () => {
  it('sin onRemoveWord, las palabras no muestran la cruz de borrar', () => {
    renderCloud()

    expect(screen.getByText('pizza')).toBeInTheDocument()
    expect(document.querySelector('.chart-word-cloud-remove')).toBeNull()
  })
})

describe('WordCloud — modo editable', () => {
  it('con onRemoveWord, ninguna palabra muestra la cruz hasta que se la clickea', () => {
    renderCloud({ onRemoveWord: vi.fn() })

    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(0)
  })

  it('clickear una palabra revela sólo su propia cruz; clickearla de nuevo la esconde', async () => {
    renderCloud({ onRemoveWord: vi.fn() })

    await userEvent.click(screen.getByText('pizza'))
    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(1)
    expect(screen.getByText('pizza').closest('.chart-word-cloud-item')).toHaveClass('is-selected')
    expect(screen.getByText('laburo').closest('.chart-word-cloud-item')).not.toHaveClass('is-selected')

    await userEvent.click(screen.getByText('pizza'))
    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(0)
  })

  it('clickear otra palabra mueve la cruz a esa, sin dejar dos abiertas', async () => {
    renderCloud({ onRemoveWord: vi.fn() })

    await userEvent.click(screen.getByText('pizza'))
    await userEvent.click(screen.getByText('laburo'))

    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(1)
    expect(screen.getByText('laburo').closest('.chart-word-cloud-item')).toHaveClass('is-selected')
    expect(screen.getByText('pizza').closest('.chart-word-cloud-item')).not.toHaveClass('is-selected')
  })

  it('clickear la cruz de una palabra ya seleccionada llama a onRemoveWord con esa palabra', async () => {
    const onRemoveWord = vi.fn()
    renderCloud({ onRemoveWord, removeLabel: 'Quitar "{word}"' })

    await userEvent.click(screen.getByText('pizza'))
    await userEvent.click(screen.getByRole('button', { name: 'Quitar "pizza"' }))

    expect(onRemoveWord).toHaveBeenCalledWith('pizza')
    expect(onRemoveWord).toHaveBeenCalledTimes(1)
  })

  it('sólo la palabra recién agregada por la búsqueda entra con la animación', () => {
    renderCloud({ onRemoveWord: vi.fn(), justAddedWord: 'laburo' })

    expect(screen.getByText('pizza').closest('.chart-word-cloud-item')).not.toHaveClass('is-new')
    expect(screen.getByText('laburo').closest('.chart-word-cloud-item')).toHaveClass('is-new')
  })
})

describe('WordCloud — recorte compacto', () => {
  // Uno más que COMPACT_WORD_LIMIT (40 — el mismo WORD_CLOUD_LIMIT que usa
  // lib/metrics.ts para cualquier nube, principal o por participante), para que
  // el recorte sea inevitable. La buscada va al final, que es justo la posición
  // que un slice ciego descartaría (ver el comentario en useEditableWordCloud
  // sobre por qué se agrega ahí).
  const manyWords = [
    ...Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, count: 60 - i })),
    { word: 'buscada', count: 1 },
  ]

  it('sin protectedWords, el recorte compacto descarta la última palabra', () => {
    render(
      <TooltipProvider>
        <WordCloud words={manyWords} compact />
      </TooltipProvider>,
    )

    expect(screen.queryByText('buscada')).not.toBeInTheDocument()
  })

  it('con protectedWords, la palabra buscada sobrevive al recorte compacto', () => {
    render(
      <TooltipProvider>
        <WordCloud words={manyWords} compact protectedWords={['buscada']} />
      </TooltipProvider>,
    )

    expect(screen.getByText('buscada')).toBeInTheDocument()
    expect(document.querySelectorAll('.chart-word-cloud-item')).toHaveLength(40)
  })

  it('una nube por participante con menos de 40 palabras no se recorta (misma cantidad que la principal)', () => {
    const fewerWords = Array.from({ length: 25 }, (_, i) => ({ word: `w${i}`, count: 25 - i }))
    render(
      <TooltipProvider>
        <WordCloud words={fewerWords} compact />
      </TooltipProvider>,
    )

    expect(document.querySelectorAll('.chart-word-cloud-item')).toHaveLength(25)
  })
})
