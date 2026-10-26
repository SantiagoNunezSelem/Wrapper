import { fireEvent, render, screen } from '@testing-library/react'
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
      dismiss={copy.testPayerBannerDismiss}
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

  it('se cierra con la cruz', () => {
    const { container } = renderBanner('test_user_9999@testuser.com')

    fireEvent.click(screen.getByRole('button', { name: copy.testPayerBannerDismiss }))

    expect(container).toBeEmptyDOMElement()
  })

  it('vuelve a aparecer en la próxima carga aunque se haya cerrado', () => {
    // El cierre no se guarda en ningún lado: se puso para no olvidarse la opción
    // activada, así que cada vez que se abre la app vuelve a avisar.
    const first = renderBanner('test_user_9999@testuser.com')
    fireEvent.click(screen.getByRole('button', { name: copy.testPayerBannerDismiss }))
    first.unmount()

    renderBanner('test_user_9999@testuser.com')

    expect(screen.getByText(/test_user_9999@testuser.com/)).toBeInTheDocument()
  })
})
