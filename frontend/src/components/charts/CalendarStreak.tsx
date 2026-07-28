import type { StreakRange } from '../../types'

const MAX_DOTS = 31

export function CalendarStreak({ streaks }: { streaks: StreakRange[] }) {
  if (streaks.length === 0) {
    return null
  }

  return (
    <div className="chart-calendar-streak">
      {streaks.map((streak) => (
        <div className="chart-streak-row" key={`${streak.startLabel}-${streak.endLabel}`}>
          <div className="chart-streak-range">
            <strong>{streak.days}</strong>
            <span>
              {streak.startLabel} → {streak.endLabel}
            </span>
          </div>
          <div className="chart-streak-dots">
            {Array.from({ length: Math.min(streak.days, MAX_DOTS) }).map((_, index) => (
              <span key={index} className="chart-streak-dot" />
            ))}
            {streak.days > MAX_DOTS ? <span className="chart-streak-overflow">+{streak.days - MAX_DOTS}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
