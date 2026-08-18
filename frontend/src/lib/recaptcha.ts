/**
 * Minimal surface of the global `grecaptcha` object this app actually calls — narrower
 * than the full API, declared here instead of pulling in a types package for three
 * methods.
 */
interface Grecaptcha {
  ready(callback: () => void): void
  execute(siteKey: string, options: { action: string }): Promise<string>
  render(
    container: HTMLElement,
    parameters: { sitekey: string; callback: (token: string) => void },
  ): number
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha
  }
}

const loadedScripts = new Set<string>()

/**
 * Injects the reCAPTCHA script once per site key and resolves once `grecaptcha` is ready
 * to use. Meant to be called as soon as the app mounts — the script itself is inert until
 * `execute`/`render` are called, so loading it early costs nothing and is invisible to
 * the user (no widget, no popup).
 */
export function loadRecaptchaScript(siteKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!siteKey) {
      resolve()
      return
    }

    if (window.grecaptcha) {
      window.grecaptcha.ready(() => resolve())
      return
    }

    if (!loadedScripts.has(siteKey)) {
      loadedScripts.add(siteKey)
      const script = document.createElement('script')
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
      script.async = true
      script.defer = true
      script.onerror = () => reject(new Error('Could not load reCAPTCHA.'))
      document.head.appendChild(script)
    }

    const start = Date.now()
    const poll = window.setInterval(() => {
      if (window.grecaptcha) {
        window.clearInterval(poll)
        window.grecaptcha.ready(() => resolve())
      } else if (Date.now() - start > 10_000) {
        window.clearInterval(poll)
        reject(new Error('reCAPTCHA did not load in time.'))
      }
    }, 100)
  })
}

/**
 * Runs the invisible v3 check for one action and returns the token the backend verifies.
 * `action` lets the backend's siteverify response confirm the token was actually issued
 * for this action, not replayed from somewhere else.
 */
export async function executeRecaptchaV3(siteKey: string, action: string): Promise<string | undefined> {
  if (!siteKey || !window.grecaptcha) {
    return undefined
  }

  return window.grecaptcha.execute(siteKey, { action })
}

/** Renders the v2 checkbox challenge into `container`, calling `onToken` once solved. */
export function renderRecaptchaV2(container: HTMLElement, siteKey: string, onToken: (token: string) => void): void {
  window.grecaptcha?.ready(() => {
    window.grecaptcha?.render(container, { sitekey: siteKey, callback: onToken })
  })
}
