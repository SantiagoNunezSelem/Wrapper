const aiDisabledKey = 'vistazo-dev-ai-disabled'
const recaptchaV3DisabledKey = 'vistazo-dev-recaptcha-v3-disabled'
const toolbarPositionKey = 'vistazo-dev-toolbar-pos'

/**
 * Whether the local-only developer toolbar should exist at all.
 *
 * Checked against the actual hostname rather than `import.meta.env.DEV`, so a production
 * build served from a real domain never shows it — even if someone runs `vite preview`
 * or ships a dev build by mistake. The VIP switch is additionally enforced server-side
 * (Development environment + loopback only); this is just the button.
 */
export function isLocalhost(): boolean {
  const { hostname } = window.location
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

/** Persisted so the setting survives the reloads that come with iterating on the app —
 * forgetting it after every refresh is exactly how tokens get spent by accident. */
export function isAiDisabled(): boolean {
  if (!isLocalhost()) {
    return false
  }

  try {
    return localStorage.getItem(aiDisabledKey) === 'true'
  } catch {
    return false
  }
}

export function setAiDisabled(value: boolean): void {
  try {
    localStorage.setItem(aiDisabledKey, String(value))
  } catch {
    // Nothing to do: the in-memory state still holds for this session.
  }
}

/** Lets the v2 fallback be tested on demand instead of waiting for a real low v3 score —
 * skips `executeRecaptchaV3` entirely, so the login POST carries no v3 token and the
 * backend (which has no way to tell "skipped" from "failed") sends back the same
 * `recaptcha_required` it would for genuine bot traffic. */
export function isRecaptchaV3Disabled(): boolean {
  if (!isLocalhost()) {
    return false
  }

  try {
    return localStorage.getItem(recaptchaV3DisabledKey) === 'true'
  } catch {
    return false
  }
}

export function setRecaptchaV3Disabled(value: boolean): void {
  try {
    localStorage.setItem(recaptchaV3DisabledKey, String(value))
  } catch {
    // Nothing to do: the in-memory state still holds for this session.
  }
}

export interface ToolbarPosition {
  top: number
  left: number
}

/** Mirrors the width `useIsMobile()` switches shells at. Only used to tag a saved drag
 * position with the shell it was dragged in — doesn't need to match the real hook's
 * touch/pointer branch, since the worst case of a mismatch is just falling back to the
 * default position instead of a wrong one. */
const MOBILE_TOOLBAR_MAX_WIDTH = 768

function isMobileLayout(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_TOOLBAR_MAX_WIDTH}px)`).matches
}

/** Where the dev toolbar was last dragged to. Null means "use the default position for
 * this shell" — never persisted as a magic (0, 0) so a missing value can't be confused
 * with an intentional drag to the corner.
 *
 * Tagged with the shell it was dragged in and ignored on a mismatch: the desktop and
 * mobile shells default the toolbar to opposite corners specifically so it doesn't sit
 * on top of the account avatar in either one, and a raw pixel spot dragged to on a wide
 * window lands somewhere arbitrary — often right on that avatar — when reused on a
 * phone-width viewport. */
export function getDevToolbarPosition(): ToolbarPosition | null {
  try {
    const raw = localStorage.getItem(toolbarPositionKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<ToolbarPosition & { isMobile: boolean }>
    if (typeof parsed.top !== 'number' || typeof parsed.left !== 'number' || parsed.isMobile !== isMobileLayout()) {
      return null
    }

    return { top: parsed.top, left: parsed.left }
  } catch {
    return null
  }
}

export function setDevToolbarPosition(position: ToolbarPosition): void {
  try {
    localStorage.setItem(toolbarPositionKey, JSON.stringify({ ...position, isMobile: isMobileLayout() }))
  } catch {
    // Session-only fallback: the toolbar keeps its dragged spot until reload.
  }
}

export function clearDevToolbarPosition(): void {
  try {
    localStorage.removeItem(toolbarPositionKey)
  } catch {
    // Nothing to clear if storage was never reachable in the first place.
  }
}
