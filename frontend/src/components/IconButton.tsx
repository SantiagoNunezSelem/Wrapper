export function CrossIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Icon-only button (a cross) for actions the user reads as "leave/close/exit" —
 * kept label-free visually, with the text preserved for screen readers/tooltips. */
export function CrossButton({
  label,
  onClick,
  className = '',
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button type="button" className={`icon-only-button ${className}`} onClick={onClick} aria-label={label} title={label}>
      <CrossIcon />
    </button>
  )
}
