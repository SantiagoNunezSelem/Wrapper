import type { StreakRange } from '../../types'

export function CalendarStreak({ streaks, unit }: { streaks: StreakRange[]; unit?: string }) {
  if (streaks.length === 0) {
    return null
  }

  return (
    <div className="chart-streak-podium">
      {streaks.map((streak, index) => (
        <div className={`chart-streak-card ${index === 0 ? 'is-first' : ''}`} key={`${streak.startLabel}-${streak.endLabel}`}>
          <span className="chart-streak-rank">{index + 1}</span>
          <div className="chart-streak-card-body">
            <strong>
              {streak.days}
              {unit ? ` ${unit}` : ''}
            </strong>
            <span>
              {streak.startLabel} – {streak.endLabel}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
