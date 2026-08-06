import type { MonthDatum } from '../../types'
import { Tooltip } from '../Tooltip'

export function MonthHeatmap({ months, unit }: { months: MonthDatum[]; unit?: string }) {
  if (months.length === 0) {
    return null
  }

  const max = Math.max(...months.map((month) => month.count), 1)

  return (
    <div className="chart-month-heatmap">
      {months.map((month) => (
        <Tooltip key={month.monthLabel} content={`${month.monthLabel} · ${month.count}${unit ? ` ${unit}` : ''}`}>
          <div className="chart-month-cell">
            <span
              className="chart-month-swatch"
              style={{ background: `rgba(34, 211, 238, ${month.count === 0 ? 0.08 : 0.28 + (month.count / max) * 0.72})` }}
            />
            <span className="chart-month-label">{month.monthLabel}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  )
}
