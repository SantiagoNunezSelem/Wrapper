import type { TimelinePoint } from '../../types'

export function Timeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) {
    return null
  }

  const max = Math.max(...points.map((point) => point.value), 1)
  const labelStep = Math.max(Math.ceil(points.length / 6), 1)

  return (
    <div className="chart-timeline">
      <div className="chart-timeline-bars">
        {points.map((point, index) => (
          <div
            key={`${point.dateLabel}-${index}`}
            className="chart-timeline-bar"
            title={`${point.dateLabel} · ${point.label}`}
          >
            <span className="chart-timeline-fill" style={{ height: `${Math.max((point.value / max) * 100, 4)}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-timeline-axis">
        {points.map((point, index) =>
          index % labelStep === 0 ? <span key={point.dateLabel}>{point.dateLabel}</span> : null,
        )}
      </div>
    </div>
  )
}
