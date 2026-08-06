import type { DonutDatum } from '../../types'
import { colorForIndex } from './palette'

const SIZE = 140
const STROKE = 20
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function Donut({ items }: { items: DonutDatum[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0)

  if (total <= 0) {
    return null
  }

  let offsetAccumulator = 0

  return (
    <div className="chart-donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="chart-donut-svg">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
        {items.map((item, index) => {
          const fraction = item.value / total
          const dash = fraction * CIRCUMFERENCE
          const segment = (
            <circle
              key={item.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={item.color ?? colorForIndex(index)}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              strokeDashoffset={-offsetAccumulator}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              strokeLinecap="butt"
            />
          )
          offsetAccumulator += dash
          return segment
        })}
      </svg>
      <ul className="chart-legend">
        {items.map((item, index) => (
          <li key={item.label}>
            <span className="chart-legend-dot" style={{ background: item.color ?? colorForIndex(index) }} />
            {item.label} · {Math.round((item.value / total) * 100)}%
          </li>
        ))}
      </ul>
    </div>
  )
}
