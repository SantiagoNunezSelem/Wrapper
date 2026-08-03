const aiDisabledKey = 'vistazo-dev-ai-disabled'
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

export interface ToolbarPosition {
  top: number
  left: number
}

/** Where the dev toolbar was last dragged to. Null means "use the default top-right
 * corner" — never persisted as a magic (0, 0) so a missing value can't be confused with
 * an intentional drag to the corner. */
export function getDevToolbarPosition(): ToolbarPosition | null {
  try {
    const raw = localStorage.getItem(toolbarPositionKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<ToolbarPosition>
    return typeof parsed.top === 'number' && typeof parsed.left === 'number'
      ? { top: parsed.top, left: parsed.left }
      : null
  } catch {
    return null
  }
}

export function setDevToolbarPosition(position: ToolbarPosition): void {
  try {
    localStorage.setItem(toolbarPositionKey, JSON.stringify(position))
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
