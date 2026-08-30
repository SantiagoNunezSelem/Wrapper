import { useState, type KeyboardEvent } from 'react'
import { isParticipantBarChart } from '../lib/metrics'
import type { ChatMessage, MetricCard as MetricCardData } from '../types'
import { AiStatePanel, type AiPanelProps } from './AiStatePanel'
import { BarRanking } from './charts/BarRanking'
import { ChartRenderer } from './charts/ChartRenderer'
import { CrossButton, SearchIcon } from './IconButton'
import { LockedPanel, type FreeUnlockPrompt } from './LockedPanel'
import { MessageGroupItem } from './MessageGroupItem'
// NUEVO: números que laten — para revertir, borrar este import y el uso de
// useCountUp más abajo (volver a `card.basic.value` directo).
import { useCountUp } from './useCountUp'
import type { WordCloudEditor, WordCloudSearchCopy } from './useEditableWordCloud'
import { PAGE_SIZE, usePaginatedReveal } from './usePaginatedReveal'

export interface MetricModalCopy {
  close: string
  detailTitle: string
  breakdownTitle: string
  showMore: string
  unlock: string
  searchPlaceholder: string
  freeUnlockLoading: string
  wordCloudSearch: WordCloudSearchCopy & { removeLabel: string }
}

export function MetricModal({
  card,
  copy,
  ai,
  freeUnlock,
  isRevealingFreeUnlock = false,
  /** The chat currently open in this tab, if any — lets the wordcloud metric's
   * search box count a word that isn't already in its precomputed top 40.
   * Undefined for a saved analysis replayed from history: only the computed
   * cards are ever kept for those, never the raw chat (see the privacy note
   * in the landing copy). */
  messages,
  /** Built by the caller (see `wordCloudEditor` in useVistazo) instead of here, so a
   * search's added/removed words survive this modal closing and reopening — only the
   * caller stays mounted for the whole session. */
  wordCloudEditor,
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
  messages?: ChatMessage[]
  wordCloudEditor: WordCloudEditor
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

  // No search box without the raw chat to search — a replayed analysis from history
  // only ever carries the precomputed cards (see the privacy note in the landing
  // copy), so a search here could never do anything but fail.
  const canSearchWords =
    Boolean(messages) &&
    (card.detail?.chart?.kind === 'wordCloud' || Boolean(card.detail?.series?.some((entry) => entry.chart.kind === 'wordCloud')))

  // The hero bar chart and the "by participant" breakdown below are often the same
  // per-sender ranking twice (see `isParticipantBarChart`) — skip the hero chart then.
  const heroChartRepeatsBreakdown =
    isParticipantBarChart(card.basic?.chart) && Boolean(card.detail?.breakdown && card.detail.breakdown.length > 0)

  async function submitWordSearch() {
    if (await wordCloudEditor.searchAndAdd(wordSearch)) {
      setWordSearch('')
    }
  }

  function handleWordSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }
    void submitWordSearch()
  }

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
                <ChartRenderer
                  chart={wordCloudEditor.displayChart ?? card.basic.chart}
                  justAddedWord={wordCloudEditor.justAddedWord}
                  wordCloudEditing={
                    card.basic.chart.kind === 'wordCloud'
                      ? {
                          onRemoveWord: wordCloudEditor.onRemoveWord,
                          removeLabel: copy.wordCloudSearch.removeLabel,
                          removingWord: wordCloudEditor.removingWord,
                          selectedWordForRemoval: wordCloudEditor.selectedWordForRemoval,
                          onToggleSelection: wordCloudEditor.toggleWordSelection,
                        }
                      : undefined
                  }
                />
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

              {canSearchWords ? (
                <>
                  <div className="word-search-row">
                    <input
                      type="search"
                      className="word-search-input"
                      placeholder={copy.searchPlaceholder}
                      value={wordSearch}
                      disabled={wordCloudEditor.isSearching}
                      onChange={(event) => {
                        setWordSearch(event.target.value.toLowerCase())
                        wordCloudEditor.clearSearchError()
                      }}
                      onKeyDown={handleWordSearchKeyDown}
                    />
                    <button
                      type="button"
                      className="word-search-button"
                      onClick={() => void submitWordSearch()}
                      disabled={wordCloudEditor.isSearching}
                      aria-label={copy.searchPlaceholder}
                    >
                      {wordCloudEditor.isSearching ? <span className="word-search-spinner" aria-hidden="true" /> : <SearchIcon />}
                    </button>
                  </div>
                  {wordCloudEditor.searchError ? <p className="word-search-error">{wordCloudEditor.searchError}</p> : null}
                </>
              ) : null}

              {card.detail.chart ? (
                <div className="modal-chart">
                  <ChartRenderer chart={card.detail.chart} />
                </div>
              ) : null}

              {wordCloudEditor.displaySeries && wordCloudEditor.displaySeries.length > 0 ? (
                <div className="series-grid">
                  {wordCloudEditor.displaySeries.map((entry) => (
                    <div className="series-item" key={entry.name}>
                      <h4>{entry.name}</h4>
                      <ChartRenderer
                        chart={entry.chart}
                        compact
                        justAddedWord={wordCloudEditor.justAddedWord}
                        protectedWords={wordCloudEditor.searchedWords}
                      />
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
