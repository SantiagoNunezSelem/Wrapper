import { useLayoutEffect, useRef, useState } from 'react'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'

// Google's own button caps out around 400px and looks cramped below ~200px, so clamp
// to that range regardless of how wide the wrapping box measures.
const MIN_BUTTON_WIDTH = 200
const MAX_BUTTON_WIDTH = 400

/**
 * Google's button only accepts a fixed pixel width (no percentage/fluid sizing), so
 * staying responsive means measuring the wrapping box ourselves and re-issuing that
 * width whenever it changes, rather than leaning on CSS alone. Measured synchronously
 * on mount (not just via ResizeObserver) so the button never waits on a first resize
 * callback to appear.
 */
export function ResponsiveGoogleLogin({
  onSuccess,
  onError,
}: {
  onSuccess: (credentialResponse: CredentialResponse) => void
  onError: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [buttonWidth, setButtonWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) {
      return
    }

    const clamp = (width: number) => Math.min(MAX_BUTTON_WIDTH, Math.max(MIN_BUTTON_WIDTH, Math.round(width)))

    setButtonWidth(clamp(el.getBoundingClientRect().width))

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setButtonWidth(clamp(width))
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapRef} className="google-login-wrap">
      {buttonWidth ? <GoogleLogin onSuccess={onSuccess} onError={onError} width={buttonWidth} /> : null}
    </div>
  )
}
