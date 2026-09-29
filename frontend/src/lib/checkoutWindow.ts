/**
 * Mercado Pago's checkout in a window of its own, on a desktop browser.
 *
 * Sending the whole tab to Mercado Pago means leaving Vistazo to pay, and coming back
 * through their redirect — or not at all, if the person closes the tab. In a separate
 * window the app stays where it was, and the checkout window closes itself once
 * Mercado Pago sends it back to us.
 *
 * Only where a window makes sense: not on a phone, and not in the installed app, where a
 * popup opens as a detached browser on top and is harder to get back from than a plain
 * redirect. Everywhere else, and whenever the browser blocks the popup, it falls back to
 * the same-tab redirect the app always used.
 */

const WINDOW_NAME = 'vistazo-mercadopago'
const CHANNEL_NAME = 'vistazo-checkout'

/** Fired on `window` when a checkout was opened in its own window. */
export const CHECKOUT_WINDOW_OPENED = 'vistazo:checkout-window-opened'

export function prefersCheckoutWindow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  return !installed && window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 768
}

/**
 * Opens (or reuses) the checkout window. Must run synchronously inside the click:
 * browsers only allow a popup that comes straight from a user gesture, which is why it
 * opens empty first and gets its address once the server has answered.
 */
function openCheckoutWindow(): Window | null {
  const width = 520
  const height = 760
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - width) / 2))
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - height) / 2))

  const opened = window.open('', WINDOW_NAME, `popup,width=${width},height=${height},left=${left},top=${top}`)
  if (!opened) {
    return null
  }

  try {
    // Only while the checkout URL is on its way; a blank window reads as broken.
    if (opened.location.href === 'about:blank') {
      opened.document.title = 'Mercado Pago'
      opened.document.body.style.cssText = 'margin:0;font:15px system-ui,sans-serif;color:#555;display:grid;place-items:center;height:100vh'
      opened.document.body.textContent = 'Abriendo Mercado Pago…'
    }
  } catch {
    // Already showing Mercado Pago from an earlier click: cross-origin, nothing to write.
  }

  return opened
}

/**
 * Sends the person to a checkout: a window of its own where that makes sense, the same
 * tab otherwise. `resolveUrl` may be the server call that opens the checkout.
 *
 * @returns `'window'` when the checkout is running in another window and this page is
 *   still here; `'redirect'` when this page is on its way out.
 */
export async function goToCheckout(resolveUrl: () => Promise<string> | string): Promise<'window' | 'redirect'> {
  const checkoutWindow = prefersCheckoutWindow() ? openCheckoutWindow() : null

  let url: string
  try {
    url = await resolveUrl()
  } catch (error) {
    checkoutWindow?.close()
    throw error
  }

  if (checkoutWindow && !checkoutWindow.closed) {
    checkoutWindow.location.href = url
    checkoutWindow.focus()
    window.dispatchEvent(new Event(CHECKOUT_WINDOW_OPENED))
    return 'window'
  }

  window.location.href = url
  return 'redirect'
}

/**
 * Runs first thing on page load. When Mercado Pago sends its window back to us
 * (`?checkout=return`), tells the other Vistazo tabs — the one that opened it, above
 * all — and closes itself.
 *
 * Told through a BroadcastChannel rather than `window.opener`: Mercado Pago's pages can
 * sever the opener link on the way through, and the channel only needs both pages to be
 * ours. If the window refuses to close, it simply stays a normal Vistazo tab that handles
 * the return itself.
 *
 * @returns true when this window is closing and nothing should be rendered in it.
 */
export function finishCheckoutInWindow(): boolean {
  if (new URLSearchParams(window.location.search).get('checkout') !== 'return') {
    return false
  }

  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage('return')
    channel.close()
  }

  if (window.name !== WINDOW_NAME && !window.opener) {
    return false
  }

  window.close()
  return window.closed
}

/** Calls `onReturn` whenever a checkout window, from any tab, came back from Mercado Pago. */
export function onCheckoutReturn(onReturn: () => void): () => void {
  if (typeof BroadcastChannel !== 'function') {
    return () => {}
  }

  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event) => {
    if (event.data === 'return') {
      onReturn()
    }
  }

  return () => channel.close()
}
