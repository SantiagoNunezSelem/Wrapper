import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../TooltipProvider'
import { WordCloud } from '../WordCloud'

const words = [
  { word: 'pizza', count: 12 },
  { word: 'laburo', count: 7 },
]

// `WordCloud` is fully controlled — it never tracks its own selection, the
// selected word is a prop coming from useEditableWordCloud. Tests that need
// "click a word, see its cross appear" wire that prop up here the same way
// the real hook would, instead of asserting on state the component doesn't own.
function renderCloud(extra: Partial<Parameters<typeof WordCloud>[0]> = {}) {
  return render(
    <TooltipProvider>
      <WordCloud words={words} {...extra} />
    </TooltipProvider>,
  )
}

describe('WordCloud — modo lectura', () => {
  it('sin manejadores de click, las palabras no son botones', () => {
    renderCloud()

    expect(screen.queryByRole('button', { name: 'pizza' })).not.toBeInTheDocument()
    expect(screen.getByText('pizza')).toBeInTheDocument()
  })

  it('nunca muestra la cruz de borrar', () => {
    renderCloud({ selectedWord: 'pizza' })

    expect(document.querySelector('.chart-word-cloud-remove')).toBeNull()
  })
})

describe('WordCloud — modo editable', () => {
  it('clickear una palabra llama a onWordClick con esa palabra', async () => {
    const onWordClick = vi.fn()
    renderCloud({ onWordClick, onDeselect: vi.fn(), onRemoveWord: vi.fn() })

    await userEvent.click(screen.getByText('pizza'))

    expect(onWordClick).toHaveBeenCalledWith('pizza')
  })

  it('la palabra seleccionada muestra su cruz de borrar; las demás no', () => {
    renderCloud({ selectedWord: 'pizza', onWordClick: vi.fn(), onDeselect: vi.fn(), onRemoveWord: vi.fn() })

    expect(document.querySelectorAll('.chart-word-cloud-remove')).toHaveLength(1)
  })

  it('clickear la cruz llama a onRemoveWord con esa palabra, no a onWordClick de nuevo', async () => {
    const onWordClick = vi.fn()
    const onRemoveWord = vi.fn()
    renderCloud({ selectedWord: 'pizza', onWordClick, onDeselect: vi.fn(), onRemoveWord, removeLabel: 'Quitar "{word}"' })

    await userEvent.click(screen.getByRole('button', { name: 'Quitar "pizza"' }))

    expect(onRemoveWord).toHaveBeenCalledWith('pizza')
    expect(onWordClick).not.toHaveBeenCalled()
  })

  it('clickear el fondo de la nube deselecciona en vez de removerse a sí misma', async () => {
    const onDeselect = vi.fn()
    renderCloud({ selectedWord: 'pizza', onWordClick: vi.fn(), onDeselect, onRemoveWord: vi.fn() })

    await userEvent.click(document.querySelector('.chart-word-cloud')!)

    expect(onDeselect).toHaveBeenCalledTimes(1)
  })
})
