import { useState } from 'react'
import { niceMax } from './scale'

export interface ColumnDatum {
  value: number
  /** Etiqueta del eje, si corresponde mostrarla. */
  label: string
  /** Lo que dice el tooltip y lo que lee un lector de pantalla al llegar con Tab. */
  tip: string
}

const W = 560
const H = 180
const LEFT = 58
const RIGHT = 8
const TOP = 12
const BOTTOM = 26

/**
 * Columnas finas sobre una sola escala: tope redondeado de 4px, base cuadrada, nunca más de
 * 24px de ancho aunque sobre lugar. Cada columna es foco de teclado, así que el valor se
 * alcanza sin mouse; el tooltip suma, no es la única forma de leerlo.
 */
export function ColumnChart({
  data,
  ariaLabel,
  formatTick,
  color,
  labels = 'ends',
}: {
  data: ColumnDatum[]
  ariaLabel: string
  formatTick: (value: number) => string
  color: string
  labels?: 'ends' | 'all'
}) {
  const [active, setActive] = useState<number | null>(null)

  const max = niceMax(Math.max(...data.map((item) => item.value), 0))
  const plotW = W - LEFT - RIGHT
  const plotH = H - TOP - BOTTOM
  const base = TOP + plotH
  const slot = plotW / Math.max(1, data.length)
  const barW = Math.max(3, Math.min(24, slot * 0.6))
  const y = (value: number) => base - (value / max) * plotH
  const ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max]

  return (
    <div className="adm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} className="adm-grid" />
            <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="adm-tick">
              {formatTick(tick)}
            </text>
          </g>
        ))}

        {data.map((item, index) => {
          const x = LEFT + slot * index + (slot - barW) / 2
          const height = (item.value / max) * plotH
          const top = base - height
          const r = Math.min(4, height, barW / 2)
          const path =
            height > 0
              ? `M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + barW - r}Q${x + barW} ${top} ${x + barW} ${top + r}V${base}Z`
              : null
          const dimmed = active !== null && active !== index

          return (
            <g key={index}>
              {path ? <path d={path} fill={color} opacity={dimmed ? 0.45 : 1} /> : null}
              {labels === 'all' ? (
                <text x={LEFT + slot * index + slot / 2} y={H - 6} textAnchor="middle" className="adm-tick">
                  {item.label}
                </text>
              ) : null}
              <rect
                x={LEFT + slot * index}
                y={TOP}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={item.tip}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            </g>
          )
        })}

        {labels === 'ends' && data.length > 0 ? (
          <>
            <text x={LEFT} y={H - 6} className="adm-tick">
              {data[0].label}
            </text>
            <text x={W - RIGHT} y={H - 6} textAnchor="end" className="adm-tick">
              {data[data.length - 1].label}
            </text>
          </>
        ) : null}
      </svg>

      {active !== null ? (
        <div
          className="adm-tip"
          role="status"
          style={{
            left: `${((LEFT + slot * active + slot / 2) / W) * 100}%`,
            top: `${(y(data[active].value) / H) * 100}%`,
          }}
        >
          {data[active].tip}
        </div>
      ) : null}
    </div>
  )
}
