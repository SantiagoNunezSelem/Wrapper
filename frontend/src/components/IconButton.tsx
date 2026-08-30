import { Tooltip } from './Tooltip'

export function CrossIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
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
    <Tooltip content={label}>
      <button type="button" className={`icon-only-button ${className}`} onClick={onClick} aria-label={label}>
        <CrossIcon />
      </button>
    </Tooltip>
  )
}
