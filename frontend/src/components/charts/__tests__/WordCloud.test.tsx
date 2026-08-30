import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../TooltipProvider'
import { WordCloud } from '../WordCloud'

const words = [
  { word: 'pizza', count: 12 },
  { word: 'laburo', count: 7 },
]

function renderCloud(extra: Partial<Parameters<typeof WordCloud>[0]> = {}) {
  return render(
    <TooltipProvider>
      <WordCloud words={words} {...extra} />
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
  it('con onRemoveWord, cada palabra lleva su cruz de borrar (revelada por hover en CSS)', () => {
    renderCloud({ onRemoveWord: vi.fn() })

    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(words.length)
  })

  it('clickear la cruz de una palabra llama a onRemoveWord con esa palabra', async () => {
    const onRemoveWord = vi.fn()
    renderCloud({ onRemoveWord, removeLabel: 'Quitar "{word}"' })

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
