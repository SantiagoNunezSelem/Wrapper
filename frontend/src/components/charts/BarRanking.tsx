import type { BarDatum } from '../../types'
import { colorForIndex } from './palette'

export function BarRanking({ items, compact = false }: { items: BarDatum[]; compact?: boolean }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className={`chart-bar-ranking ${compact ? 'is-compact' : ''}`}>
      {items.map((item, index) => (
        <div className="chart-bar-row" key={item.label}>
          <span className="chart-bar-label">{item.label}</span>
          <span className="chart-bar-track">
            <span className="chart-bar-fill" style={{ background: item.color ?? colorForIndex(index) }} />
          </span>
          <span className="chart-bar-value">{item.displayValue}</span>
        </div>
      ))}
    </div>
  )
}
