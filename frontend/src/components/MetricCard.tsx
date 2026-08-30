import { memo, useRef, type MouseEvent } from 'react'
import { prefersReducedMotion } from '../lib/prefersReducedMotion'
import type { MetricCard as MetricCardData } from '../types'
import { AiStatePanel, type AiPanelProps } from './AiStatePanel'
import { ChartRenderer } from './charts/ChartRenderer'
import { LockedPanel } from './LockedPanel'
import { useCountUpOnView } from './useCountUp'

/** How far a card tilts toward the cursor, in degrees at the very edge. Read
 * once — nobody changes their OS motion setting mid-session. */
const MAX_TILT_DEG = 7
const tiltEnabled = !prefersReducedMotion()

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor">
      <path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8Z" />
    </svg>
  )
}

/**
 * Memoizada. La grilla monta 25 de éstas, cada una con su gráfico (el
 * heatmap anual son 365 celdas SVG), y sin esto cualquier cambio de estado del
 * shell —abrir el menú de cuenta, abrir el modal de una métrica— las volvía a
 * dibujar todas. Depende de que `ai` y `onUnlock` lleguen con identidad estable
 * desde `useVistazo`; si alguna vuelve a construirse en cada render, esto deja
 * de servir en silencio.
 */
export const MetricCard = memo(function MetricCard({
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

  // Tilt magnético al cursor + números que laten al entrar en pantalla.
  const cardRef = useRef<HTMLElement>(null)
  const [statValue, statRef] = useCountUpOnView<HTMLElement>(card.basic?.value ?? '')

  // Written straight to the DOM instead of React state: a mousemove-driven
  // rotation needs to update every frame, and routing that through state would
  // re-render the whole card (chart included) 60 times a second for nothing.
  function handleMouseMove(event: MouseEvent<HTMLElement>) {
    const node = cardRef.current
    if (!tiltEnabled || !node) {
      return
    }

    const rect = node.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    const rotateX = (0.5 - py) * MAX_TILT_DEG
    const rotateY = (px - 0.5) * MAX_TILT_DEG

    node.style.transform = `translateY(-3px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
    node.style.setProperty('--spot-x', `${px * 100}%`)
    node.style.setProperty('--spot-y', `${py * 100}%`)
  }

  function handleMouseLeave() {
    const node = cardRef.current
    if (node) {
      node.style.transform = ''
    }
  }

  return (
    <article
      ref={cardRef}
      className={`metric-card ${card.accent} ${locked || aiBlocked ? 'is-locked' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
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
            <strong ref={statRef}>{statValue}</strong>
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
})
