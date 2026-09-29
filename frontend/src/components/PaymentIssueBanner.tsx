import { useState } from 'react'

const dismissedKey = 'vistazo.paymentIssueDismissed'

/**
 * A declined charge, said wherever the person is using the app — not only on the account
 * screen, which someone whose Pro still works has no reason to open. Mercado Pago keeps
 * retrying for days and access stays on meanwhile, so this is a heads-up, not an alarm:
 * one line, a way to the account screen, and a close button.
 *
 * Closing it lasts for the tab, not forever. A charge that keeps failing should come back
 * the next time the app is opened — that is the point of saying it outside the account
 * screen at all.
 */
export function PaymentIssueBanner({
  visible,
  text,
  cta,
  dismiss,
  onReview,
}: {
  visible: boolean
  text: string
  cta: string
  dismiss: string
  onReview: () => void
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(dismissedKey) === '1'
    } catch {
      return false
    }
  })

  if (!visible || dismissed) {
    return null
  }

  function handleDismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(dismissedKey, '1')
    } catch {
      // Storage blocked: closed for now, back on the next page load.
    }
  }

  return (
    <div className="payment-issue-banner" role="status">
      <p className="payment-issue-banner-text">{text}</p>
      <button type="button" className="payment-issue-banner-cta" onClick={onReview}>
        {cta}
      </button>
      <button type="button" className="payment-issue-banner-close" onClick={handleDismiss} aria-label={dismiss}>
        ×
      </button>
    </div>
  )
}
