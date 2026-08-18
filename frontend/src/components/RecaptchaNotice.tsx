import type { Language } from '../types'

/**
 * Google's badge is hidden via CSS (see .grecaptcha-badge in styles/base.css) because it
 * clashes with the rest of the UI — but Google's terms require the attribution to appear
 * somewhere in the flow when the badge itself is hidden. This is that somewhere: shown
 * next to the login button, the one action reCAPTCHA actually gates.
 *
 * Wording and links are Google's required boilerplate, not product copy — kept as fixed
 * JSX per language instead of going through shellCopy, so it can't drift from what their
 * terms ask for.
 */
export function RecaptchaNotice({ language }: { language: Language }) {
  return language === 'es' ? (
    <p className="recaptcha-notice">
      Este sitio está protegido por reCAPTCHA y se aplican la{' '}
      <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
        Política de Privacidad
      </a>{' '}
      y los{' '}
      <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
        Términos de Servicio
      </a>{' '}
      de Google.
    </p>
  ) : (
    <p className="recaptcha-notice">
      This site is protected by reCAPTCHA and the Google{' '}
      <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
        Privacy Policy
      </a>{' '}
      and{' '}
      <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
        Terms of Service
      </a>{' '}
      apply.
    </p>
  )
}
