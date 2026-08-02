import type { MetricCard as MetricCardData } from '../types'
import { AiStatePanel, type AiPanelProps } from './AiStatePanel'
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
  ai,
  onOpen,
  onUnlock,
}: {
  card: MetricCardData
  seeMoreLabel: string
  unlockLabel: string
  /** Passed only to viewers with Pro access; everyone else gets the ordinary upsell. */
  ai?: AiPanelProps
  onOpen: (card: MetricCardData) => void
  onUnlock: () => void
}) {
  // "Pro, but the AI hasn't produced a verdict" is a different state from "not Pro":
  // it gets its own panel with a retry, instead of an upsell for a plan you already own.
  const aiBlocked = Boolean(ai && card.ai && card.ai.status !== 'ready')
  const locked = !aiBlocked && card.tier === 'vip' && !card.basic

  return (
    <article className={`metric-card ${card.accent} ${locked || aiBlocked ? 'is-locked' : ''}`}>
      <div className="metric-card-head">
        <h3>{card.title}</h3>
        {card.tier === 'vip' ? (
          <span className={`metric-tier-dot ${locked ? 'is-locked' : 'is-unlocked'}`}>
            <CrownIcon />
          </span>
        ) : null}
      </div>

      <p className="metric-description">{card.description}</p>

      {aiBlocked ? (
        <AiStatePanel state={card.ai!} {...ai!} />
      ) : locked || !card.basic ? (
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
