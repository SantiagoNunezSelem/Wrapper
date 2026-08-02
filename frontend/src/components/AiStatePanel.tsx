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
  consentCta: string
  unavailableTitle: string
  unavailableBody: string
  pendingTitle: string
  pendingBody: string
}

/** Everything a card needs to render the AI state, passed down as one unit. Present
 * only for viewers with Pro access — everyone else sees the ordinary upsell. */
export interface AiPanelProps {
  copy: AiPanelCopy
  /** False when the chat isn't loaded in memory, so a retry has nothing to rebuild from. */
  canRetry: boolean
  isBusy: boolean
  onRetry: () => void
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
}: AiPanelProps & { state: AiCardState; tall?: boolean }) {
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
            <p>{copy.consentBody}</p>
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
            <p>{copy.pendingBody}</p>
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
