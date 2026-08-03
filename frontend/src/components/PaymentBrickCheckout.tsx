import { Payment, initMercadoPago } from '@mercadopago/sdk-react'
import { useState } from 'react'

const publicKey = import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY as string | undefined

// Mirrors every other MP integration example: one instance for the whole app, created as
// soon as this module loads rather than per-render. Safe to call even if the Brick is
// never actually mounted on a given page view — it only sets up a static SDK instance.
if (publicKey) {
  initMercadoPago(publicKey, { locale: 'es-AR' })
}

export interface PaymentBrickCheckoutCopy {
  missingKey: string
  loading: string
  tokenMissing: string
  securedBy: string
}

/**
 * Wraps Mercado Pago's actual "Payment Brick" (`Payment` in the SDK) rather than the
 * narrower "Card Payment Brick" (`CardPayment`) this used to wrap. This is the literal
 * product Santiago pointed at — it renders
 * Mercado Pago's own multi-method picker (card, Pago Fácil/Rapipago, Mercado Pago account
 * balance) instead of a bare card form we theme to match this site, which is the whole
 * point: it should be unmistakable that Mercado Pago, not this page, is handling the
 * payment. Only the card path has a working backend today (subscriptions can only
 * recur via a tokenized card) — anything else the payer picks still runs through
 * Mercado Pago's real UI, it just has nowhere to land on our side yet.
 */
export function PaymentBrickCheckout({
  copy,
  amount,
  payerEmail,
  onSubmit,
  onError,
}: {
  copy: PaymentBrickCheckoutCopy
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
    <div className="payment-brick">
      <p className="payment-brick-badge">
        <LockIcon /> {copy.securedBy}
      </p>

      {!isReady ? <p className="card-brick-loading">{copy.loading}</p> : null}

      <div className="payment-brick-surface">
        <Payment
          initialization={{ amount, payer: { email: payerEmail } }}
          customization={{
            paymentMethods: {
              creditCard: 'all',
              debitCard: 'all',
              ticket: 'all',
              mercadoPago: 'all',
              // A subscription bills one full period at a time — there is nothing to
              // split into installments, so the picker is pinned to a single option.
              minInstallments: 1,
              maxInstallments: 1,
            },
            // Deliberately Mercado Pago's own default look, not this site's palette —
            // see the component doc comment above.
            visual: { style: { theme: 'default' } },
          }}
          onReady={() => setIsReady(true)}
          onSubmit={async (formData) => {
            const token = (formData.formData as { token?: string } | undefined)?.token

            if (!token) {
              onError(copy.tokenMissing)
              throw new Error('Payment Brick did not return a card token for this payment method.')
            }

            await onSubmit(token)
          }}
          onError={(brickError) => onError(brickError.message)}
        />
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
