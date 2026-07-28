import type { MonthDatum } from '../../types'

export function MonthHeatmap({ months }: { months: MonthDatum[] }) {
  if (months.length === 0) {
    return null
  }

  const max = Math.max(...months.map((month) => month.count), 1)

  return (
    <div className="chart-month-heatmap">
      {months.map((month) => (
        <div key={month.monthLabel} className="chart-month-cell" title={`${month.monthLabel} · ${month.count}`}>
          <span
            className="chart-month-swatch"
            style={{ background: `rgba(34, 211, 238, ${month.count === 0 ? 0.08 : 0.28 + (month.count / max) * 0.72})` }}
          />
          <span className="chart-month-label">{month.monthLabel}</span>
        </div>
      ))}
    </div>
  )
}
