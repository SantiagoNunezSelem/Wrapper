function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path className="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// Misma corona (path y color ámbar) que ya usa el shell mobile para marcar VIP
// (`shells/mobile/icons.tsx`, `CrownIcon`) — así el círculo de escritorio no
// inventa un segundo lenguaje visual para lo mismo.
function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
      <path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8Z" />
    </svg>
  )
}

export function VipBadge({ active, label, compact = false }: { active: boolean; label: string; compact?: boolean }) {
  return (
    <div className={`vip-badge ${compact ? 'is-compact' : ''}`}>
      <span className={`vip-badge-circle ${active ? 'is-active' : 'is-locked'}`}>{active ? <CrownIcon /> : <LockIcon />}</span>
      <span className="vip-badge-label">{label}</span>
    </div>
  )
}
