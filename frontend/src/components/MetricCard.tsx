import type { MetricCard as MetricCardData } from '../types'
import { ChartRenderer } from './charts/ChartRenderer'
import { LockedPanel } from './LockedPanel'

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor">
      <path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8Z" />
    </svg>
  )
}

export function MetricCard({
  card,
  seeMoreLabel,
  unlockLabel,
  onOpen,
  onUnlock,
}: {
  card: MetricCardData
  seeMoreLabel: string
  unlockLabel: string
  onOpen: (card: MetricCardData) => void
  onUnlock: () => void
}) {
  const locked = card.tier === 'vip' && !card.basic

  return (
    <article className={`metric-card ${card.accent} ${locked ? 'is-locked' : ''}`}>
      <div className="metric-card-head">
        <h3>{card.title}</h3>
        {card.tier === 'vip' ? (
          <span className={`metric-tier-dot ${locked ? 'is-locked' : 'is-unlocked'}`}>
            <CrownIcon />
          </span>
        ) : null}
      </div>

      <p className="metric-description">{card.description}</p>

      {locked || !card.basic ? (
        <LockedPanel preview={card.preview} unlockLabel={unlockLabel} onUnlock={onUnlock} />
      ) : (
        <div className="metric-basic">
          <div className="metric-stat">
            <strong>{card.basic.value}</strong>
            <span>{card.basic.label}</span>
          </div>
          {card.basic.note ? <p className="metric-note">{card.basic.note}</p> : null}
          {card.basic.chart ? (
            <div className="metric-chart">
              <ChartRenderer chart={card.basic.chart} compact />
            </div>
          ) : null}
        </div>
      )}

      <button type="button" className="detail-button" onClick={() => onOpen(card)}>
        {seeMoreLabel}
      </button>
    </article>
  )
}
