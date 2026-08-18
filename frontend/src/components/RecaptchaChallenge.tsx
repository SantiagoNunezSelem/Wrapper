import { useEffect, useRef } from 'react'
import { renderRecaptchaV2 } from '../lib/recaptcha'

/**
 * The v2 checkbox, shown only after the backend rejects a login because the silent v3
 * score came back too low. Both shells mount this the same way inside their existing
 * auth modal — no separate modal of its own.
 */
export function RecaptchaChallenge({
  siteKey,
  onSolved,
  title,
  body,
}: {
  siteKey: string
  onSolved: (token: string) => void
  /** Omit when the caller already shows this text elsewhere (e.g. a sheet header). */
  title?: string
  body?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (containerRef.current && siteKey) {
      renderRecaptchaV2(containerRef.current, siteKey, onSolved)
    }
    // Rendered once per mount — the widget manages its own solved/expired state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  return (
    <div className="recaptcha-challenge">
      {title ? <p className="eyebrow">{title}</p> : null}
      {body ? <p className="panel-copy">{body}</p> : null}
      <div ref={containerRef} />
    </div>
  )
}
