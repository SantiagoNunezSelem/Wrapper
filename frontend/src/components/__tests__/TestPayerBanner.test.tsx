import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { TestPayerBanner } from '../TestPayerBanner'

const copy = shellCopy.es.subscriptionPage

function renderBanner(email: string | null) {
  return render(
    <TestPayerBanner
      email={email}
      title={copy.testPayerBannerTitle}
      body={copy.testPayerBannerBody}
    />,
  )
}

describe('TestPayerBanner', () => {
  it('no dibuja nada cuando no hay pagador de prueba forzado', () => {
    // El caso de todo despliegue real. Un cartel que aparece siempre deja de leerse.
    const { container } = renderBanner(null)

    expect(container).toBeEmptyDOMElement()
  })

  it('nombra el mail que va a recibir todos los checkouts', () => {
    // El mail es el dato con el que se verifica que sea el comprador de prueba y no
    // alguien real: sin él el cartel avisa de un problema sin decir cuál.
    renderBanner('test_user_9999@testuser.com')

    expect(screen.getByText(/test_user_9999@testuser\.com/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(copy.testPayerBannerTitle))).toBeInTheDocument()
  })

  it('no ofrece ninguna forma de cerrarse', () => {
    // Es la razón de ser del componente: se puso justamente para no olvidarse la opción
    // activada, y un aviso que se descarta es un aviso que se olvida.
    renderBanner('test_user_9999@testuser.com')

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
