import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'
import { useState } from 'react'

const publicKey = import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY as string | undefined

// Mirrors every other MP integration example: one instance for the whole app, created as
// soon as this module loads rather than per-render. Safe to call even if the Brick is
// never actually mounted on a given page view — it only sets up a static SDK instance.
if (publicKey) {
  initMercadoPago(publicKey, { locale: 'es-AR' })
}

export interface CardCheckoutBrickCopy {
  missingKey: string
  loading: string
  tokenMissing: string
}

/**
 * Thin wrapper around Mercado Pago's Card Payment Brick. It owns nothing about what
 * happens with the resulting token — the card fields are rendered, validated, and
 * tokenized entirely by Mercado Pago's own embedded UI, and only the finished `token`
 * ever reaches this app's code (via `onSubmit`). Raw card data never touches this
 * component's state, this app's network calls, or this backend.
 *
 * `onSubmit` must resolve/reject: that is how the Brick knows whether to show its own
 * "submitted" state or let the payer try again — see
 * https://www.mercadopago.com/developers/en/docs/checkout-bricks/card-payment-brick/payment-submission.
 */
export function CardCheckoutBrick({
  copy,
  amount,
  payerEmail,
  onSubmit,
  onError,
}: {
  copy: CardCheckoutBrickCopy
  amount: number
  payerEmail: string
  onSubmit: (cardTokenId: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [isReady, setIsReady] = useState(false)

  if (!publicKey) {
    return <p className="error-banner">{copy.missingKey}</p>
  }

  return (
    <div className="card-brick">
      {/* Left mounted throughout rather than hidden until ready: the Brick manages its
          own internal loading skeleton, and fighting its layout with CSS visibility
          tricks is more likely to break it than to improve the wait. */}
      {!isReady ? <p className="card-brick-loading">{copy.loading}</p> : null}

      <CardPayment
        initialization={{ amount, payer: { email: payerEmail } }}
        customization={{
          // A subscription bills one full period at a time — there is nothing to split
          // into installments, so the picker is pinned to a single option instead of
          // offering a choice that would never apply.
          paymentMethods: { minInstallments: 1, maxInstallments: 1 },
          visual: { style: { theme: 'dark' } },
        }}
        onReady={() => setIsReady(true)}
        onSubmit={async (formData) => {
          if (!formData.token) {
            onError(copy.tokenMissing)
            throw new Error('Card Payment Brick did not return a token.')
          }

          await onSubmit(formData.token)
        }}
        onError={(brickError) => onError(brickError.message)}
      />
    </div>
  )
}
