import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGoogleOAuth, type CredentialResponse, type GsiButtonConfiguration, type IdConfiguration } from '@react-oauth/google'

// Google's own button caps out around 400px and looks cramped below ~200px, so clamp
// to that range regardless of how wide the wrapping box measures.
const MIN_BUTTON_WIDTH = 200
const MAX_BUTTON_WIDTH = 400

/** The slice of Google Identity Services this component calls. The script itself is
 * loaded by `GoogleOAuthProvider` (see main.tsx). */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: IdConfiguration) => void
      renderButton: (parent: HTMLElement, options: GsiButtonConfiguration & { locale?: string }) => void
    }
  }
}

/**
 * Google's button only accepts a fixed pixel width (no percentage/fluid sizing), so
 * staying responsive means measuring the wrapping box ourselves and re-issuing that
 * width whenever it changes, rather than leaning on CSS alone. Measured synchronously
 * on mount (not just via ResizeObserver) so the button never waits on a first resize
 * callback to appear.
 *
 * Draws the button through GIS directly instead of `<GoogleLogin>`: that component only
 * reads the locale from `GoogleOAuthProvider`, once, so the button stayed in whatever
 * language the browser had ("Acceder con Google" next to an English UI) and never
 * followed the app's language toggle.
 */
export function ResponsiveGoogleLogin({
  onSuccess,
  onError,
  locale,
}: {
  onSuccess: (credentialResponse: CredentialResponse) => void
  onError: () => void
  /** The app's language — the button follows it, including after a toggle. */
  locale: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const [buttonWidth, setButtonWidth] = useState<number | null>(null)
  const { clientId, scriptLoadedSuccessfully } = useGoogleOAuth()

  // Read through refs so a parent re-render with fresh inline handlers doesn't
  // re-initialize GIS and redraw the button.
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  onSuccessRef.current = onSuccess
  onErrorRef.current = onError

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

  useEffect(() => {
    const google = (window as unknown as { google?: GoogleIdentity }).google
    const target = buttonRef.current
    if (!scriptLoadedSuccessfully || !google || !target || !buttonWidth) {
      return
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (!response?.credential) {
          onErrorRef.current()
          return
        }
        onSuccessRef.current({ credential: response.credential, clientId, select_by: response.select_by })
      },
    })
    google.accounts.id.renderButton(target, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: buttonWidth,
      locale,
    })
  }, [scriptLoadedSuccessfully, clientId, buttonWidth, locale])

  return (
    <div ref={wrapRef} className="google-login-wrap">
      <div ref={buttonRef} style={{ height: 40 }} />
    </div>
  )
}
