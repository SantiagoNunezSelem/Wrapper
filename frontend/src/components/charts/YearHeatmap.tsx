import type { CalendarDay } from '../../types'
import { Tooltip } from '../Tooltip'

export function YearHeatmap({ days, unit }: { days: CalendarDay[]; unit?: string }) {
  if (days.length === 0) {
    return null
  }

  const countByDate = new Map(days.map((day) => [day.date, day.count]))
  const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date))
  const start = new Date(sorted[0].date)
  const end = new Date(sorted[sorted.length - 1].date)
  const startAligned = new Date(start)
  startAligned.setDate(start.getDate() - start.getDay())

  const max = Math.max(...days.map((day) => day.count), 1)
  const cells: { date: string; count: number; column: number; row: number }[] = []
  const cursor = new Date(startAligned)
  let column = 0

  while (cursor <= end) {
    const row = cursor.getDay()
    const iso = cursor.toISOString().slice(0, 10)
    cells.push({ date: iso, count: countByDate.get(iso) ?? 0, column, row })
    if (row === 6) {
      column += 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return (
    <div className="chart-year-heatmap" style={{ gridTemplateColumns: `repeat(${column + 1}, minmax(0, 1fr))` }}>
      {cells.map((cell) => (
        <Tooltip key={cell.date} content={`${cell.date} · ${cell.count}${unit ? ` ${unit}` : ''}`}>
          <span
            className="chart-year-cell"
            style={{
              gridColumn: cell.column + 1,
              gridRow: cell.row + 1,
              background: `rgba(34, 211, 238, ${cell.count === 0 ? 0.08 : 0.28 + (cell.count / max) * 0.72})`,
            }}
          />
        </Tooltip>
      ))}
    </div>
  )
}
