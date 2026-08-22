import { useMemo, useState } from 'react'
import { isParticipantBarChart } from '../lib/metrics'
import type { ChartData, MetricCard as MetricCardData } from '../types'
import { AiStatePanel, type AiPanelProps } from './AiStatePanel'
import { BarRanking } from './charts/BarRanking'
import { ChartRenderer } from './charts/ChartRenderer'
import { CrossButton } from './IconButton'
import { LockedPanel, type FreeUnlockPrompt } from './LockedPanel'
import { MessageGroupItem } from './MessageGroupItem'
// NUEVO: números que laten — para revertir, borrar este import y el uso de
// useCountUp más abajo (volver a `card.basic.value` directo).
import { useCountUp } from './useCountUp'
import { PAGE_SIZE, usePaginatedReveal } from './usePaginatedReveal'

export interface MetricModalCopy {
  close: string
  detailTitle: string
  breakdownTitle: string
  showMore: string
  unlock: string
  searchPlaceholder: string
  freeUnlockLoading: string
}

export function MetricModal({
  card,
  copy,
  ai,
  freeUnlock,
  isRevealingFreeUnlock = false,
  onClose,
  onUnlock,
}: {
  card: MetricCardData
  copy: MetricModalCopy
  /** Passed only to viewers with Pro access; everyone else gets the ordinary upsell. */
  ai?: AiPanelProps
  /** Set only where a daily free unlock could actually be spent — see `freeUnlockFor`. */
  freeUnlock?: FreeUnlockPrompt
  /** True for the few seconds right after this card's free unlock was confirmed —
   * see `revealingFreeUnlockId` in useVistazo. */
  isRevealingFreeUnlock?: boolean
  onClose: () => void
  onUnlock: () => void
}) {
  const groupsPagination = usePaginatedReveal(PAGE_SIZE)
  const itemsPagination = usePaginatedReveal(PAGE_SIZE)
  const [wordSearch, setWordSearch] = useState('')

  const aiBlocked = Boolean(ai && card.ai && card.ai.status !== 'ready')
  const basicLocked = !aiBlocked && card.tier === 'vip' && !card.basic
  const detailLocked = !aiBlocked && !card.detail
  const statValue = useCountUp(card.basic?.value ?? '') // NUEVO

  const hasWordCloud =
    card.detail?.chart?.kind === 'wordCloud' || Boolean(card.detail?.series?.some((entry) => entry.chart.kind === 'wordCloud'))

  // The hero bar chart and the "by participant" breakdown below are often the same
  // per-sender ranking twice (see `isParticipantBarChart`) — skip the hero chart then.
  const heroChartRepeatsBreakdown =
    isParticipantBarChart(card.basic?.chart) && Boolean(card.detail?.breakdown && card.detail.breakdown.length > 0)

  const filteredDetailChart = useMemo(
    () => (card.detail?.chart ? filterWordCloud(card.detail.chart, wordSearch) : undefined),
    [card.detail?.chart, wordSearch],
  )

  const filteredSeries = useMemo(
    () => card.detail?.series?.map((entry) => ({ name: entry.name, chart: filterWordCloud(entry.chart, wordSearch) })) ?? [],
    [card.detail?.series, wordSearch],
  )

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card metric-modal" onClick={(event) => event.stopPropagation()}>
        <CrossButton label={copy.close} onClick={onClose} className="close-button" />

        <h2>{card.title}</h2>
        <p className="panel-copy modal-description">{card.description}</p>

        {aiBlocked ? (
          <AiStatePanel state={card.ai!} {...ai!} tall />
        ) : basicLocked ? (
          <LockedPanel preview={card.preview} unlockLabel={copy.unlock} onUnlock={onUnlock} />
        ) : card.basic ? (
          <div className="modal-basic">
            <div className="metric-stat is-large">
              {/* ANTES: <strong>{card.basic.value}</strong> */}
              <strong>{statValue}</strong>
              <span>{card.basic.label}</span>
            </div>
            {card.basic.note ? <p className="metric-note">{card.basic.note}</p> : null}
            {card.basic.chart && !heroChartRepeatsBreakdown ? (
              <div className="modal-chart">
                <ChartRenderer chart={card.basic.chart} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* An AI-blocked card already explains itself above — repeating the same panel
            for the breakdown would just be the same message twice. */}
        <div className="modal-detail-section" hidden={aiBlocked}>
          <h3>{copy.detailTitle}</h3>

          {detailLocked ? (
            <LockedPanel
              preview={card.preview}
              unlockLabel={copy.unlock}
              onUnlock={onUnlock}
              freeUnlock={freeUnlock}
              isRevealing={isRevealingFreeUnlock}
              revealingLabel={copy.freeUnlockLoading}
              tall
            />
          ) : card.detail ? (
            <>
              {card.detail.intro ? <p className="panel-copy">{card.detail.intro}</p> : null}

              {hasWordCloud ? (
                <input
                  type="search"
                  className="word-search-input"
                  placeholder={copy.searchPlaceholder}
                  value={wordSearch}
                  onChange={(event) => setWordSearch(event.target.value.toLowerCase())}
                />
              ) : null}

              {filteredDetailChart ? (
                <div className="modal-chart">
                  <ChartRenderer chart={filteredDetailChart} />
                </div>
              ) : null}

              {filteredSeries.length > 0 ? (
                <div className="series-grid">
                  {filteredSeries.map((entry) => (
                    <div className="series-item" key={entry.name}>
                      <h4>{entry.name}</h4>
                      <ChartRenderer chart={entry.chart} compact />
                    </div>
                  ))}
                </div>
              ) : null}

              {card.detail.breakdown && card.detail.breakdown.length > 0 ? (
                <div className="breakdown-section">
                  <h4>{copy.breakdownTitle}</h4>
                  <BarRanking
                    items={card.detail.breakdown.map((entry) => ({
                      label: entry.name,
                      value: entry.value,
                      displayValue: entry.displayValue,
                      color: entry.color,
                    }))}
                  />
                </div>
              ) : null}

              {card.detail.groups && card.detail.groups.length > 0 ? (
                <div className="paginated-section">
                  <h4>{card.detail.groupsLabel ?? card.detail.paginatedItemsLabel ?? copy.detailTitle}</h4>
                  <div className="message-group-list" ref={groupsPagination.setListRef}>
                    {card.detail.groups.slice(0, groupsPagination.visibleCount).map((group, index) => (
                      <MessageGroupItem
                        key={group.id}
                        group={group}
                        isNew={groupsPagination.revealedFrom !== null && index >= groupsPagination.revealedFrom}
                      />
                    ))}
                  </div>
                  {groupsPagination.visibleCount < card.detail.groups.length ? (
                    <button type="button" className="ghost-button show-more-button" onClick={groupsPagination.showMore}>
                      {copy.showMore} ({groupsPagination.visibleCount}/{card.detail.groups.length})
                    </button>
                  ) : null}
                </div>
              ) : null}

              {card.detail.paginatedItems && card.detail.paginatedItems.length > 0 ? (
                <div className="paginated-section">
                  <h4>{card.detail.paginatedItemsLabel ?? copy.detailTitle}</h4>
                  <ul className="detail-list" ref={itemsPagination.setListRef}>
                    {card.detail.paginatedItems.slice(0, itemsPagination.visibleCount).map((item, index) => (
                      <li key={index} className={itemsPagination.revealedFrom !== null && index >= itemsPagination.revealedFrom ? 'is-new' : ''}>
                        {item}
                      </li>
                    ))}
                  </ul>
                  {itemsPagination.visibleCount < card.detail.paginatedItems.length ? (
                    <button type="button" className="ghost-button show-more-button" onClick={itemsPagination.showMore}>
                      {copy.showMore} ({itemsPagination.visibleCount}/{card.detail.paginatedItems.length})
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function filterWordCloud(chart: ChartData, search: string): ChartData {
  if (chart.kind !== 'wordCloud' || !search) {
    return chart
  }
  return { kind: 'wordCloud', words: chart.words.filter((word) => word.word.includes(search)) }
}
