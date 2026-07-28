const HOUR_MARKS = [0, 6, 12, 18]

export function HourHeatmap({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1)

  return (
    <div className="chart-hour-heatmap">
      <div className="chart-hour-cells">
        {hours.map((value, hour) => (
          <span
            key={hour}
            className="chart-hour-cell"
            style={{ opacity: 0.12 + (value / max) * 0.88 }}
            title={`${hour.toString().padStart(2, '0')}:00 · ${value}`}
          />
        ))}
      </div>
      <div className="chart-hour-marks">
        {HOUR_MARKS.map((hour) => (
          <span key={hour}>{hour.toString().padStart(2, '0')}h</span>
        ))}
      </div>
    </div>
  )
}
