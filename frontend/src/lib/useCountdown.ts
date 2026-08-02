import { useEffect, useState } from 'react'

/**
 * Whole seconds left until `target`, ticking once a second and clamped at zero.
 *
 * The deadline is an absolute timestamp issued by the server, not a duration started
 * in the browser — so the countdown survives a refresh, keeps running down while the
 * tab is in the background, and reads the same on every device.
 */
export function useSecondsUntil(target: string | null | undefined): number {
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(target))

  useEffect(() => {
    setSecondsLeft(remainingSeconds(target))

    if (!target) {
      return
    }

    // Recomputed from the deadline on every tick rather than decremented, so a
    // throttled background tab can't leave the number stuck above zero.
    const timer = setInterval(() => {
      const next = remainingSeconds(target)
      setSecondsLeft(next)

      if (next <= 0) {
        clearInterval(timer)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [target])

  return secondsLeft
}

function remainingSeconds(target?: string | null): number {
  if (!target) {
    return 0
  }

  const milliseconds = new Date(target).getTime() - Date.now()
  return milliseconds <= 0 ? 0 : Math.ceil(milliseconds / 1000)
}

/** Formats a countdown as m:ss (or just seconds when under a minute). */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
