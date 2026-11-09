import { formatCountdown, useSecondsUntil } from '../lib/useCountdown'
import type { AiCardState } from '../types'

export interface AiPanelCopy {
  failedTitle: string
  /** Friendly one-liners keyed by the backend's error code, plus a `default` fallback. */
  reasons: Record<string, string>
  retry: string
  /** Contains `{time}`, replaced with the remaining countdown. */
  retryIn: string
  retrying: string
  /** Shown when the retry would work but the chat is no longer loaded in memory. */
  needsUpload: string
  consentTitle: string
  consentBody: string
  /** The same ask, for the personalities card: it is not about false positives. */
  consentBodyProfiles: string
  consentCta: string
  unavailableTitle: string
  unavailableBody: string
  pendingTitle: string
  pendingBody: string
  pendingBodyProfiles: string
  /** Heading of the notice over a card that is showing its local reading. */
  fallbackTitle: string
  /** What the notice says the card is showing instead. */
  fallbackBody: string
  /** The notice's reason when this installation simply has no AI configured. */
  fallbackUnavailable: string
  /** Small chip on the card itself, so the local reading is never mistaken for the AI's. */
  fallbackBadge: string
}

/** Everything a card needs to render the AI state, passed down as one unit. Present
 * only for viewers with Pro access — everyone else sees the ordinary upsell. */
export interface AiPanelProps {
  copy: AiPanelCopy
  /** False when the chat isn't loaded in memory, so a retry has nothing to rebuild from. */
  canRetry: boolean
  isBusy: boolean
  onRetry: () => void
  /** Retries just the personalities, which are asked for separately from the metrics. */
  onRetryProfiles: () => void
  onConsent: () => void
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

/**
 * Stands in for an AI-backed metric that has no verdict to show. Deliberately a
 * per-card state: when one metric's AI call fails the other twenty-four keep their
 * numbers, and only this card asks to be run again.
 */
export function AiStatePanel({
  state,
  copy,
  canRetry,
  isBusy,
  onRetry,
  onConsent,
  tall = false,
  forProfiles = false,
}: Omit<AiPanelProps, 'onRetryProfiles'> & { state: AiCardState; tall?: boolean; forProfiles?: boolean }) {
  const secondsLeft = useSecondsUntil(state.status === 'failed' ? state.retryAvailableAtUtc : null)
  const isCoolingDown = secondsLeft > 0

  return (
    <div className={`locked-panel ai-panel ${tall ? 'is-tall' : ''}`}>
      <div className="locked-skeleton" aria-hidden="true">
        <span className="skeleton-bar" style={{ width: '84%' }} />
        <span className="skeleton-bar" style={{ width: '58%' }} />
        <span className="skeleton-bar" style={{ width: '72%' }} />
        {tall ? (
          <>
            <span className="skeleton-bar" style={{ width: '46%' }} />
            <span className="skeleton-bar" style={{ width: '66%' }} />
          </>
        ) : null}
      </div>

      <div className="locked-overlay">
        <span className="locked-icon ai-icon">
          <SparkIcon />
        </span>

        {state.status === 'consent' ? (
          <>
            <strong className="ai-panel-title">{copy.consentTitle}</strong>
            <p>{forProfiles ? copy.consentBodyProfiles : copy.consentBody}</p>
            <button type="button" className="unlock-button" onClick={onConsent}>
              {copy.consentCta}
            </button>
          </>
        ) : null}

        {state.status === 'unavailable' ? (
          <>
            <strong className="ai-panel-title">{copy.unavailableTitle}</strong>
            <p>{copy.unavailableBody}</p>
          </>
        ) : null}

        {state.status === 'pending' ? (
          <>
            <strong className="ai-panel-title">{copy.pendingTitle}</strong>
            <p>{forProfiles ? copy.pendingBodyProfiles : copy.pendingBody}</p>
          </>
        ) : null}

        {state.status === 'failed' ? (
          <>
            <strong className="ai-panel-title">{copy.failedTitle}</strong>
            <p>{copy.reasons[state.errorCode ?? 'default'] ?? copy.reasons.default}</p>

            {/* When the chat is no longer in memory there is nothing to rebuild the
                candidates from, so the button asks for the upload instead of pretending
                a retry is one click away. */}
            <button type="button" className="unlock-button" onClick={onRetry} disabled={isBusy || isCoolingDown}>
              {isBusy ? copy.retrying : canRetry ? copy.retry : copy.needsUpload}
            </button>

            {/* The wait is spelled out under the button so a disabled control never
                looks like a dead one. */}
            {isCoolingDown ? (
              <p className="ai-countdown">{copy.retryIn.replace('{time}', formatCountdown(secondsLeft))}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The strip over a card that is showing its own local reading because the AI could not do
 * it. The card is not blocked — it has real content — so this says what the content is,
 * why, and offers another go. Never shown for a card the AI answered: the local reading is
 * the fallback, not an alternative.
 */
export function AiFallbackNotice({
  state,
  copy,
  canRetry,
  isBusy,
  onRetryProfiles,
}: Omit<AiPanelProps, 'onRetry' | 'onConsent'> & { state: AiCardState }) {
  const secondsLeft = useSecondsUntil(state.status === 'failed' ? state.retryAvailableAtUtc : null)
  const isCoolingDown = secondsLeft > 0
  const canAskAgain = state.status === 'failed'
  const reason =
    state.status === 'unavailable'
      ? copy.fallbackUnavailable
      : (copy.reasons[state.errorCode ?? 'default'] ?? copy.reasons.default)

  return (
    <div className="ai-fallback" role="status">
      <div className="ai-fallback-text">
        <strong>{copy.fallbackTitle}</strong>
        <p>
          {reason} {copy.fallbackBody}
        </p>
        {canAskAgain && isCoolingDown ? (
          <p className="ai-countdown">{copy.retryIn.replace('{time}', formatCountdown(secondsLeft))}</p>
        ) : null}
      </div>

      {canAskAgain ? (
        <button type="button" className="ghost-button" onClick={onRetryProfiles} disabled={isBusy || isCoolingDown}>
          {isBusy ? copy.retrying : canRetry ? copy.retry : copy.needsUpload}
        </button>
      ) : null}
    </div>
  )
}
