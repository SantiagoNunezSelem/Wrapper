function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path className="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function VipBadge({ active, label, compact = false }: { active: boolean; label: string; compact?: boolean }) {
  return (
    <div className={`vip-badge ${compact ? 'is-compact' : ''}`}>
      <span className={`vip-badge-circle ${active ? 'is-active' : 'is-locked'}`}>{active ? <CheckIcon /> : <LockIcon />}</span>
      <span className="vip-badge-label">{label}</span>
    </div>
  )
}
