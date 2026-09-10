/**
 * Says, on every screen, that checkout is running against a forced test payer.
 *
 * Deliberately impossible to dismiss. `MercadoPago:TestPayerEmail` is a switch that is
 * safe while you remember it is on and expensive the moment you forget: every checkout
 * opens as that one payer instead of the customer clicking the button, and nothing else
 * in the app looks the least bit wrong while it happens. A banner with a close button is
 * a banner that gets closed and then forgotten, which is the exact failure it exists to
 * prevent — so it stays until the setting is cleared.
 *
 * Renders nothing at all when the setting is empty, which is every real deployment.
 */
export function TestPayerBanner({
  email,
  title,
  body,
}: {
  email: string | null
  title: string
  body: string
}) {
  if (!email) {
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
    </div>
  )
}
