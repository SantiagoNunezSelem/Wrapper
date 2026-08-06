import type { RadarDatum } from '../../types'

const SIZE = 220
const CENTER = SIZE / 2
const MAX_RADIUS = 62
// Where the day-name labels sit, past the outer ring so they never overlap the
// shape itself even when a value maxes out that ring.
const LABEL_RADIUS = MAX_RADIUS + 26

function pointOnCircle(index: number, total: number, radius: number): [number, number] {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)]
}

export function RadarChart({ axes }: { axes: RadarDatum[] }) {
  if (axes.length < 3) {
    return null
  }

  const max = Math.max(...axes.map((axis) => axis.value), 1)
  const points = axes
    .map((axis, index) => pointOnCircle(index, axes.length, (axis.value / max) * MAX_RADIUS).join(','))
    .join(' ')

  return (
    <div className="chart-radar">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {[0.33, 0.66, 1].map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, index) => pointOnCircle(index, axes.length, MAX_RADIUS * ring).join(',')).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = pointOnCircle(index, axes.length, MAX_RADIUS)
          return <line key={axis.axis} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" />
        })}
        <polygon points={points} fill="rgba(192, 132, 252, 0.32)" stroke="#c084fc" strokeWidth={2} />
        {axes.map((axis, index) => {
          const [x, y] = pointOnCircle(index, axes.length, (axis.value / max) * MAX_RADIUS)
          return <circle key={axis.axis} cx={x} cy={y} r={3} fill="#22d3ee" />
        })}
        {/* Always-on labels, not a hover tooltip — a 7-point star has no obvious way
            to tell which tip is which day otherwise, and hover doesn't exist on
            mobile anyway. Drawn last so they sit above the ring lines. */}
        {axes.map((axis, index) => {
          const [x, y] = pointOnCircle(index, axes.length, LABEL_RADIUS)
          return (
            <g key={axis.axis}>
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="chart-radar-axis-name">
                {axis.axis}
              </text>
              <text x={x} y={y + 13} textAnchor="middle" dominantBaseline="middle" className="chart-radar-axis-value">
                {axis.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
