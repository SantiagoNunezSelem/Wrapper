import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { PaymentIssueBanner } from '../PaymentIssueBanner'

const copy = shellCopy.es.subscriptionPage

function renderBanner(visible = true, onReview = vi.fn()) {
  render(
    <PaymentIssueBanner
      visible={visible}
      text={copy.paymentIssueBannerText}
      cta={copy.paymentIssueBannerCta}
      dismiss={copy.paymentIssueBannerDismiss}
      onReview={onReview}
    />,
  )
  return onReview
}

describe('PaymentIssueBanner', () => {
  beforeEach(() => sessionStorage.clear())

  it('sin un cobro rechazado no aparece', () => {
    renderBanner(false)
    expect(screen.queryByText(copy.paymentIssueBannerText)).not.toBeInTheDocument()
  })

  it('dice que no se pudo cobrar y lleva a revisar', async () => {
    const onReview = renderBanner()

    expect(screen.getByText(copy.paymentIssueBannerText)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.paymentIssueBannerCta }))

    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('se puede cerrar, y cerrado queda para el resto de la pestaña', async () => {
    renderBanner()
    await userEvent.click(screen.getByRole('button', { name: copy.paymentIssueBannerDismiss }))

    expect(screen.queryByText(copy.paymentIssueBannerText)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('vistazo.paymentIssueDismissed')).toBe('1')
  })
})
