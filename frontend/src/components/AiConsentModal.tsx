import { ModalShell } from './ModalShell'

export interface AiConsentCopy {
  eyebrow: string
  title: string
  body: string
  bullets: readonly string[]
  accept: string
  decline: string
  close: string
  working: string
}

/**
 * The one-time opt-in before anything is sent for AI analysis. It exists because the
 * rest of the app promises the chat stays in the browser, and these two metrics are
 * the single exception — so the exception is stated plainly and the user chooses it.
 */
export function AiConsentModal({
  copy,
  isBusy,
  onAccept,
  onDismiss,
}: {
  copy: AiConsentCopy
  isBusy: boolean
  onAccept: () => void
  onDismiss: () => void
}) {
  return (
    <ModalShell onDismiss={onDismiss} label={copy.title} className="auth-modal" closeLabel={copy.close}>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>
        <p className="panel-copy">{copy.body}</p>

        <ul className="consent-list">
          {copy.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>

        <div className="consent-actions">
          <button type="button" className="primary-button" onClick={onAccept} disabled={isBusy}>
            {isBusy ? copy.working : copy.accept}
          </button>
          <button type="button" className="ghost-button" onClick={onDismiss}>
            {copy.decline}
          </button>
        </div>
    </ModalShell>
  )
}
