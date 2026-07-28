import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartData, MetricCard as MetricCardData } from '../types'
import { BarRanking } from './charts/BarRanking'
import { ChartRenderer } from './charts/ChartRenderer'
import { CrossButton } from './IconButton'
import { LockedPanel } from './LockedPanel'
import { MessageGroupItem } from './MessageGroupItem'

const PAGE_SIZE = 5

export interface MetricModalCopy {
  close: string
  detailTitle: string
  breakdownTitle: string
  showMore: string
  unlock: string
  searchPlaceholder: string
}

/** Paginates one "show more" list with a brief highlight on the freshly-revealed
 * items. Metrics can carry a `groups` list and a `paginatedItems` list at the same
 * time (e.g. spicy messages + spicy words), so each needs its own independent
 * paging state — sharing one counter would make revealing one list jump the other. */
function usePaginatedReveal(pageSize: number) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [revealedFrom, setRevealedFrom] = useState<number | null>(null)
  const listRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (revealedFrom === null) {
      return
    }
    const target = listRef.current?.children[revealedFrom] as HTMLElement | undefined
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const timeout = setTimeout(() => setRevealedFrom(null), 1000)
    return () => clearTimeout(timeout)
  }, [revealedFrom])

  return {
    visibleCount,
    revealedFrom,
    setListRef: (node: HTMLElement | null) => {
      listRef.current = node
    },
    showMore: () => {
      setRevealedFrom(visibleCount)
      setVisibleCount((count) => count + pageSize)
    },
  }
}

export function MetricModal({
  card,
  copy,
  onClose,
  onUnlock,
}: {
  card: MetricCardData
  copy: MetricModalCopy
  onClose: () => void
  onUnlock: () => void
}) {
  const groupsPagination = usePaginatedReveal(PAGE_SIZE)
  const itemsPagination = usePaginatedReveal(PAGE_SIZE)
  const [wordSearch, setWordSearch] = useState('')

  const basicLocked = card.tier === 'vip' && !card.basic
  const detailLocked = !card.detail

  const hasWordCloud =
    card.detail?.chart?.kind === 'wordCloud' || Boolean(card.detail?.series?.some((entry) => entry.chart.kind === 'wordCloud'))

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

        {basicLocked ? (
          <LockedPanel preview={card.preview} unlockLabel={copy.unlock} onUnlock={onUnlock} />
        ) : card.basic ? (
          <div className="modal-basic">
            <div className="metric-stat is-large">
              <strong>{card.basic.value}</strong>
              <span>{card.basic.label}</span>
            </div>
            {card.basic.note ? <p className="metric-note">{card.basic.note}</p> : null}
            {card.basic.chart ? (
              <div className="modal-chart">
                <ChartRenderer chart={card.basic.chart} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-detail-section">
          <h3>{copy.detailTitle}</h3>

          {detailLocked ? (
            <LockedPanel preview={card.preview} unlockLabel={copy.unlock} onUnlock={onUnlock} tall />
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
