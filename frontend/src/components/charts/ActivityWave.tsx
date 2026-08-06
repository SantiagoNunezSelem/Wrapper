import { useId, useMemo, useRef } from 'react'
import type { TimelinePoint } from '../../types'
import { Tooltip } from '../Tooltip'

const WIDTH = 300
const HEIGHT = 140
const PAD_TOP = 14
const PAD_BOTTOM = 22

interface WaveGeometry {
  linePath: string
  areaPath: string
  baseline: number
  slices: { x: number; width: number }[]
  // The curve's actual (x, y) per point — where each slice's tooltip should
  // anchor, as opposed to `slices`, which is the (much larger) hover target.
  coords: [number, number][]
  peakPoint: [number, number] | null
}

/** A hover/tap target per point spans the chart's *full height*, not just a small
 * dot on the curve — precisely hitting a specific pixel on a wavy line is hard
 * with a mouse and near-impossible with a fingertip, so each point gets its own
 * full-height column instead. Same mechanism serves both platforms: hover shows
 * it instantly (see Tooltip), a tap toggles it — there's no separate "mobile
 * design" needed here, just tap targets generous enough for a thumb. */
export function ActivityWave({ points }: { points: TimelinePoint[] }) {
  const gradientId = useId()
  const geometry = useMemo(() => buildWaveGeometry(points), [points])
  const markerRefs = useRef<(SVGCircleElement | null)[]>([])

  if (points.length === 0 || !geometry) {
    return null
  }

  const { linePath, areaPath, baseline, slices, coords, peakPoint } = geometry
  const fillId = `${gradientId}-fill`
  const strokeId = `${gradientId}-stroke`

  return (
    <div className="chart-activity-wave">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" className="chart-activity-wave-svg" role="img" aria-hidden="true">
        <defs>
          <linearGradient id={fillId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: 'var(--vz-brand-cyan)', stopOpacity: 0.36 }} />
            <stop offset="100%" style={{ stopColor: 'var(--vz-brand-cyan)', stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={strokeId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: 'var(--vz-brand-cyan)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--vz-brand-violet)' }} />
          </linearGradient>
        </defs>

        <line x1={0} y1={baseline} x2={WIDTH} y2={baseline} className="chart-activity-wave-baseline" />
        <path d={areaPath} fill={`url(#${fillId})`} className="chart-activity-wave-area" />
        <path d={linePath} fill="none" stroke={`url(#${strokeId})`} className="chart-activity-wave-line" />
        {peakPoint ? (
          <circle cx={peakPoint[0]} cy={peakPoint[1]} r={4} className="chart-activity-wave-peak-dot" />
        ) : null}

        {slices.map((slice, index) => {
          const [x, y] = coords[index]
          return (
            <g key={index}>
              {/* Not the hover target — just where the tooltip should point. Zero
                  size and no pointer events of its own; see the Tooltip prop doc. */}
              <circle ref={(node) => { markerRefs.current[index] = node }} cx={x} cy={y} r={0} fill="none" />
              <Tooltip content={`${points[index].dateLabel} · ${points[index].label}`} getAnchor={() => markerRefs.current[index]}>
                <rect x={slice.x} y={0} width={slice.width} height={HEIGHT} fill="transparent" />
              </Tooltip>
            </g>
          )
        })}
      </svg>
      <div className="chart-activity-wave-axis">
        <span>{points[0].dateLabel}</span>
        <span>{points[points.length - 1].dateLabel}</span>
      </div>
    </div>
  )
}

function buildWaveGeometry(points: TimelinePoint[]): WaveGeometry | null {
  if (points.length === 0) {
    return null
  }

  const max = Math.max(...points.map((point) => point.value), 1)
  const baseline = HEIGHT - PAD_BOTTOM
  const usableHeight = baseline - PAD_TOP

  const coords: [number, number][] = points.map((point, index) => {
    const x = points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH
    const y = baseline - (point.value / max) * usableHeight
    return [x, y]
  })

  const linePath = catmullRomPath(coords)
  const areaPath = `${linePath} L ${WIDTH.toFixed(1)},${baseline.toFixed(1)} L 0,${baseline.toFixed(1)} Z`

  const sliceWidth = WIDTH / points.length
  const slices = points.map((_, index) => ({ x: index * sliceWidth, width: sliceWidth }))

  const peakIndex = points.reduce((best, point, index) => (point.value > points[best].value ? index : best), 0)
  const peakPoint = points[peakIndex].value > 0 ? coords[peakIndex] : null

  return { linePath, areaPath, baseline, slices, coords, peakPoint }
}

function catmullRomPath(points: [number, number][]): string {
  if (points.length === 1) {
    return `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
  }

  let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)} `
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[index + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `
  }
  return d
}
