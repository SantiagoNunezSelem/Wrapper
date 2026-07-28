import type { BarDatum } from '../../types'
import { colorForIndex } from './palette'

export function BarRanking({ items, compact = false }: { items: BarDatum[]; compact?: boolean }) {
  if (items.length === 0) {
    return null
  }

  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className={`chart-bar-ranking ${compact ? 'is-compact' : ''}`}>
      {items.map((item, index) => (
        <div className="chart-bar-row" key={item.label}>
          <span className="chart-bar-label">{item.label}</span>
          <span className="chart-bar-track">
            <span
              className="chart-bar-fill"
              style={{
                width: `${Math.max((item.value / max) * 100, 3)}%`,
                background: colorForIndex(index),
              }}
            />
          </span>
          <span className="chart-bar-value">{item.displayValue}</span>
        </div>
      ))}
    </div>
  )
}
