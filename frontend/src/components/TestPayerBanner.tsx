import { useState } from 'react'

/**
 * Says, on every screen, that checkout is running against a forced test payer.
 *
 * `MercadoPago:TestPayerEmail` is a switch that is safe while you remember it is on and
 * expensive the moment you forget: every checkout opens as that one payer instead of the
 * customer clicking the button, and nothing else in the app looks the least bit wrong
 * while it happens. So the close button only hides it until the next page load — never
 * stored anywhere — and it is back every time the app is opened until the setting is
 * cleared.
 *
 * Renders nothing at all when the setting is empty, which is every real deployment.
 */
export function TestPayerBanner({
  email,
  title,
  body,
  dismiss,
}: {
  email: string | null
  title: string
  body: string
  dismiss: string
}) {
  const [dismissed, setDismissed] = useState(false)

  if (!email || dismissed) {
    return null
  }

  return (
    <div className="test-payer-banner" role="status">
      <span className="test-payer-banner-mark" aria-hidden="true">
        ⚠
      </span>
      <p className="test-payer-banner-text">
        <strong>{title}</strong> {body.split('{email}').join(email)}
      </p>
      <button type="button" className="test-payer-banner-close" onClick={() => setDismissed(true)} aria-label={dismiss}>
        ×
      </button>
    </div>
  )
}
