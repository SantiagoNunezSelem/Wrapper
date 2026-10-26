import { useEffect, useId, useState, type FormEvent } from 'react'
import { ApiError, sendSupportReport } from '../lib/api'
import type { Language, SupportReportCategory, UserProfile } from '../types'
import { SubpageHeader } from './SubpageHeader'

/** Lo mismo que exige el backend (SupportReportService): el form ya no deja mandar menos. */
const MIN_DESCRIPTION = 10
const MAX_DESCRIPTION = 4000

const CATEGORIES: readonly SupportReportCategory[] = ['pagos', 'analisis', 'cuenta', 'otro']

export interface HelpPageCopy {
  eyebrow: string
  title: string
  lead: string
  backToApp: string
  signInPrompt: string
  signInCta: string
  formTitle: string
  emailLabel: string
  emailHint: string
  categoryLabel: string
  categories: Record<SupportReportCategory, string>
  descriptionLabel: string
  descriptionPlaceholder: string
  counter: string
  technicalNote: string
  submit: string
  sending: string
  sentTitle: string
  sentBody: string
  /** El rótulo que va encima del código de seguimiento que se lleva quien manda el reporte. */
  sentTicket: string
  sentTicketHint: string
  errors: {
    invalid_email: string
    description_too_short: string
    description_too_long: string
    rate_limited: string
    generic: string
    daily_limit: string
    weekly_limit: string
    /** Con `{code}`: se agrega a daily_limit / weekly_limit cuando el reporte sigue abierto. */
    ticketOpen: string
    /** Con `{code}`: lo mismo, cuando ya figura como resuelto. */
    ticketResolved: string
  }
  termsLink: string
}

/**
 * La página de ayuda (`/ayuda`): un formulario para reportar un problema. A propósito no
 * está en ningún menú — se llega desde el "¿Tuviste algún problema?" al pie de la
 * suscripción, que es donde aparecen casi todos los problemas que importan.
 *
 * El reporte queda en el panel admin (sección Reportes) y en ningún otro lado: no se manda
 * ningún mail. Pide sesión porque es lo que deja abrir la cuenta al lado del reporte.
 */
export function HelpPage({
  language,
  copy,
  user,
  token,
  onBack,
  onLanguageToggle,
  onSignIn,
  onOpenTerms,
}: {
  language: Language
  copy: HelpPageCopy
  user: UserProfile | null
  token: string | null
  onBack: () => void
  onLanguageToggle: () => void
  onSignIn: () => void
  onOpenTerms: () => void
}) {
  const fieldId = useId()
  const [email, setEmail] = useState(user?.email ?? '')
  const [category, setCategory] = useState<SupportReportCategory | ''>('')
  const [description, setDescription] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  // Lo que se muestra después de mandar: a dónde se va a responder y con qué código quedó.
  const [sent, setSent] = useState<{ email: string; ticketCode: string } | null>(null)

  // La sesión se restaura después del primer render: el mail de la cuenta llega tarde y
  // tiene que ocupar el campo si nadie escribió nada todavía.
  useEffect(() => {
    if (user?.email) {
      setEmail((current) => current || user.email)
    }
  }, [user?.email])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !category || isSending) {
      return
    }

    setError('')
    setIsSending(true)

    try {
      const receipt = await sendSupportReport(token, {
        contactEmail: email.trim(),
        category,
        description: description.trim(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        language,
      })
      setSent({ email: email.trim(), ticketCode: receipt.ticketCode })
      setDescription('')
      setCategory('')
    } catch (caught) {
      console.error(caught)
      setError(errorMessage(caught, copy))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="subpage">
      <SubpageHeader language={language} backLabel={copy.backToApp} onBack={onBack} onLanguageToggle={onLanguageToggle} />

      <main className="subpage-content">
        <div className="subpage-hero">
          <p className="subpage-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="subpage-lead">{copy.lead}</p>
        </div>

        {!user ? (
          <section className="subpage-section subpage-signin">
            <p>{copy.signInPrompt}</p>
            <button type="button" className="primary-button" onClick={onSignIn}>
              {copy.signInCta}
            </button>
          </section>
        ) : sent ? (
          <section className="subpage-section help-sent" role="status">
            <h2>{copy.sentTitle}</h2>
            <div className="help-ticket">
              <span className="help-ticket-label">{copy.sentTicket}</span>
              <strong className="help-ticket-code">{sent.ticketCode}</strong>
            </div>
            <p className="subpage-muted-copy">{copy.sentTicketHint}</p>
            <p className="subpage-muted-copy">{copy.sentBody.replace('{email}', sent.email)}</p>
            <div className="help-actions">
              <button type="button" className="primary-button" onClick={onBack}>
                {copy.backToApp}
              </button>
            </div>
          </section>
        ) : (
          <section className="subpage-section" aria-labelledby={`${fieldId}-title`}>
            <h2 id={`${fieldId}-title`}>{copy.formTitle}</h2>
            <form className="help-form" onSubmit={handleSubmit}>
              {/* El label lleva sólo el rótulo; la aclaración y el contador van aparte,
                  por aria-describedby, para que no se lean como parte del nombre del campo. */}
              <div className="help-field">
                <label className="help-field-label" htmlFor={`${fieldId}-email`}>
                  {copy.emailLabel}
                </label>
                <input
                  id={`${fieldId}-email`}
                  type="email"
                  className="help-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={320}
                  required
                  disabled={isSending}
                  aria-describedby={`${fieldId}-email-hint`}
                />
                <span id={`${fieldId}-email-hint`} className="help-field-hint">
                  {copy.emailHint}
                </span>
              </div>

              <div className="help-field">
                <label className="help-field-label" htmlFor={`${fieldId}-category`}>
                  {copy.categoryLabel}
                </label>
                <select
                  id={`${fieldId}-category`}
                  className="help-input"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as SupportReportCategory)}
                  required
                  disabled={isSending}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {copy.categories[item]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="help-field">
                <label className="help-field-label" htmlFor={`${fieldId}-description`}>
                  {copy.descriptionLabel}
                </label>
                <textarea
                  id={`${fieldId}-description`}
                  className="help-input help-textarea"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={copy.descriptionPlaceholder}
                  minLength={MIN_DESCRIPTION}
                  maxLength={MAX_DESCRIPTION}
                  rows={6}
                  required
                  disabled={isSending}
                  aria-describedby={`${fieldId}-counter`}
                />
                <span id={`${fieldId}-counter`} className="help-field-hint help-counter">
                  {copy.counter.replace('{n}', String(description.length)).replace('{max}', String(MAX_DESCRIPTION))}
                </span>
              </div>

              <p className="subpage-muted-copy">{copy.technicalNote}</p>

              {error ? (
                <p className="subpage-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="help-actions">
                <button type="submit" className="primary-button" disabled={isSending}>
                  {isSending ? copy.sending : copy.submit}
                </button>
              </div>
            </form>
          </section>
        )}

        <p className="help-footer">
          <button type="button" className="help-link" onClick={onOpenTerms}>
            {copy.termsLink}
          </button>
        </p>
      </main>
    </div>
  )
}

/** El backend responde con un `code` propio para cada rechazo; el texto en pantalla es el nuestro. */
function errorMessage(caught: unknown, copy: HelpPageCopy): string {
  if (caught instanceof ApiError) {
    // Antes del 429 genérico: los topes también son 429, pero traen el ticket que la cuenta ya tiene.
    if (caught.code === 'daily_limit' || caught.code === 'weekly_limit') {
      const limit = copy.errors[caught.code]
      const ticket = caught.data?.ticketCode
      if (typeof ticket !== 'string') {
        return limit
      }
      const about = caught.data?.ticketStatus === 'resuelto' ? copy.errors.ticketResolved : copy.errors.ticketOpen
      return `${limit} ${about.replace('{code}', ticket)}`
    }
    if (caught.status === 429) {
      return copy.errors.rate_limited
    }
    if (caught.code === 'invalid_email' || caught.code === 'description_too_short' || caught.code === 'description_too_long') {
      return copy.errors[caught.code]
    }
  }
  return copy.errors.generic
}
