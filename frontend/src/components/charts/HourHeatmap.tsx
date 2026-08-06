import { Tooltip } from '../Tooltip'

const HOUR_MARKS = [0, 6, 12, 18]

/** Same range `metricReloj` sums for "owls" (lib/metrics.ts) — the bars for these
 * hours read a touch dimmer, a quiet echo of the same night/day split. */
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4])

/** How close to either edge (in hour-slots) the peak has to be before the badge
 * switches from centering on its bar to hugging that edge instead — otherwise a
 * peak at, say, 22h centers a wide badge past the card's right edge, where
 * `.metric-card`'s `overflow: hidden` (desktop.css) just cuts it off. */
const EDGE_ZONE = 2

export function HourHeatmap({
  hours,
  peakPeriodLabel,
  unit,
}: {
  hours: number[]
  peakPeriodLabel?: string
  unit?: string
}) {
  const trueMax = Math.max(...hours)
  const max = Math.max(trueMax, 1)
  const peakHour = trueMax > 0 ? hours.indexOf(trueMax) : -1
  const peakEdge = peakHour < EDGE_ZONE ? 'start' : peakHour >= hours.length - EDGE_ZONE ? 'end' : null

  return (
    <div className="chart-hour-heatmap">
      <div className="chart-hour-bars">
        {hours.map((value, hour) => {
          const heightPct = Math.max((value / max) * 100, 4)
          return (
            <Tooltip key={hour} content={`${hour.toString().padStart(2, '0')}:00 · ${value}${unit ? ` ${unit}` : ''}`}>
              <div className={`chart-hour-bar ${NIGHT_HOURS.has(hour) ? 'is-night' : ''}`}>
                {hour === peakHour ? (
                  <span
                    className={`chart-hour-peak-badge ${peakEdge ? `is-edge-${peakEdge}` : ''}`}
                    style={{ bottom: `calc(${heightPct}% + 6px)` }}
                  >
                    {value}
                  </span>
                ) : null}
                <span className="chart-hour-bar-fill" style={{ height: `${heightPct}%` }} />
              </div>
            </Tooltip>
          )
        })}
      </div>
      <div className="chart-hour-marks">
        {HOUR_MARKS.map((hour) => (
          <span key={hour}>{hour.toString().padStart(2, '0')}h</span>
        ))}
      </div>
      {peakPeriodLabel ? <p className="chart-hour-caption">{peakPeriodLabel}</p> : null}
    </div>
  )
}
