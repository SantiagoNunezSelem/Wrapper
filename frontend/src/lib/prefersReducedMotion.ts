/** True if the visitor asked the OS for less motion. Read once at call time,
 * not tracked reactively — nobody flips this preference mid-session, and the
 * handful of callers (tilt, count-up) only need it before they start. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
