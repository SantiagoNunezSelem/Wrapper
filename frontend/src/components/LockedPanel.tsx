/**
 * What a locked panel offers besides the plain VIP upsell: this account's daily free
 * unlocks. Present only where one could actually be spent — a free-tier metric's detail,
 * for a signed-in viewer without Pro, on an analysis still held in memory.
 *
 * `onUse` is null once the day's allowance is gone; the panel then falls back to the VIP
 * button and explains, via `waitNote`, when the free ones come back.
 */
export interface FreeUnlockPrompt {
  label: string
  waitNote: string | null
  onUse: (() => void) | null
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path className="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function LockedPanel({
  preview,
  unlockLabel,
  onUnlock,
  freeUnlock,
  isRevealing = false,
  revealingLabel,
  tall = false,
}: {
  preview: string
  unlockLabel: string
  onUnlock: () => void
  freeUnlock?: FreeUnlockPrompt
  /** True for the few seconds right after a free unlock was confirmed — see
   * `confirmFreeUnlock` in useVistazo. Swaps the lock/CTA for a spinner, still scoped to
   * this panel: the point is a wait that reads as "this card is fetching", not a
   * screen-wide freeze. */
  isRevealing?: boolean
  /** Required together with `isRevealing`. */
  revealingLabel?: string
  tall?: boolean
}) {
  const canUseFreeUnlock = Boolean(freeUnlock?.onUse)

  return (
    <div className={`locked-panel ${tall ? 'is-tall' : ''}`}>
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
        {isRevealing ? (
          <>
            <span className="locked-spinner" aria-hidden="true" />
            <p>{revealingLabel}</p>
          </>
        ) : (
          <>
            <span className="locked-icon">
              <LockIcon />
            </span>
            <p>{preview}</p>

            {/* One button, never two: with unlocks left the free one is plainly the
                better offer, and once they run out the VIP upsell is the only thing
                left to say. */}
            {canUseFreeUnlock ? (
              <button type="button" className="unlock-button is-free" onClick={freeUnlock!.onUse!}>
                {freeUnlock!.label}
              </button>
            ) : (
              <button type="button" className="unlock-button" onClick={onUnlock}>
                {unlockLabel}
              </button>
            )}

            {freeUnlock?.waitNote ? <p className="locked-wait-note">{freeUnlock.waitNote}</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
