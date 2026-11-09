import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../../copy/shellCopy'
import { MobileHome } from '../MobileViews'

/**
 * Los links a las guías son la única forma en que Google llega a las páginas de contenido
 * desde la portada: tienen que ser `<a href>` de verdad (un botón con onClick no se sigue) y
 * estar en el HTML que renderiza la app. Esas páginas sólo existen en español.
 */
function renderHome(language: 'es' | 'en') {
  return render(
    <MobileHome
      copy={shellCopy[language]}
      saved={[]}
      isLoadingSaved={false}
      language={language}
      busyMessage=""
      demoCards={[]}
      onUpload={vi.fn()}
      onOpenDemo={vi.fn()}
      onOpenSaved={vi.fn()}
      onDeleteSaved={vi.fn()}
      onRenameSaved={vi.fn()}
      onSeeAll={vi.fn()}
    />,
  )
}

describe('MobileHome: links a las páginas de contenido', () => {
  it('en español enlaza a las guías, a las métricas y a las preguntas frecuentes', () => {
    renderHome('es')

    expect(screen.getByRole('link', { name: 'Guías' })).toHaveAttribute('href', '/guias')
    expect(screen.getByRole('link', { name: 'Métricas' })).toHaveAttribute('href', '/metricas')
    expect(screen.getByRole('link', { name: 'Preguntas frecuentes' })).toHaveAttribute('href', '/preguntas-frecuentes')
  })

  it('en inglés no manda a nadie a páginas que sólo existen en español', () => {
    renderHome('en')

    expect(screen.queryByRole('link', { name: /guides|guías/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /metrics|métricas/i })).not.toBeInTheDocument()
  })
})
