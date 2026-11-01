import type { CSSProperties } from 'react'
import type { MetricCard } from '../types'

export interface PlanExamplesProps {
  cards: MetricCard[]
  tagLabel: string
  tierLabel: string
  moreLabel: string
  onOpen: (card: MetricCard) => void
}

/**
 * "Qué incluye" as the landing's example cards instead of a paragraph per benefit: real
 * metrics over the invented chat (see buildLandingPreviewCards). Only the number and its
 * label fit here, so the popover stays short on a phone; the chart and the messages wait
 * in the detail, which opens with the same example data.
 */
export function PlanExamples({ cards, tagLabel, tierLabel, moreLabel, onOpen }: PlanExamplesProps) {
  return (
    <div className="plan-examples-track">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="plan-example"
          style={{ '--vz-accent': `var(--vz-${card.accent})` } as CSSProperties}
          onClick={() => onOpen(card)}
        >
          <span className="plan-example-tag">{tagLabel}</span>
          <span className="plan-example-title">{card.title}</span>
          <span className="plan-example-stat">
            <strong>{card.basic?.value}</strong>
            <span>{card.basic?.label}</span>
          </span>
          <span className="plan-example-foot">
            <span className="plan-example-tier">{tierLabel}</span>
            <span className="plan-example-more">
              {moreLabel}
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
