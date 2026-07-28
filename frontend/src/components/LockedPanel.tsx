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
  tall = false,
}: {
  preview: string
  unlockLabel: string
  onUnlock: () => void
  tall?: boolean
}) {
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
        <span className="locked-icon">
          <LockIcon />
        </span>
        <p>{preview}</p>
        <button type="button" className="unlock-button" onClick={onUnlock}>
          {unlockLabel}
        </button>
      </div>
    </div>
  )
}
