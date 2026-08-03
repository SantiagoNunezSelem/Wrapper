import { useLayoutEffect, useRef, useState } from 'react'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'

const HORIZONTAL_MARGIN = 500

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

    setButtonWidth(Math.round(el.getBoundingClientRect().width - HORIZONTAL_MARGIN * 2))

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setButtonWidth(Math.round(width - HORIZONTAL_MARGIN * 2))
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
