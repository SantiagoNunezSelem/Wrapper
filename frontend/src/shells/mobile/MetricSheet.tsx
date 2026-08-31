import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AiStatePanel, type AiPanelProps } from '../../components/AiStatePanel'
import { BarRanking } from '../../components/charts/BarRanking'
import { ChartRenderer, type WordCloudEditing } from '../../components/charts/ChartRenderer'
import { LockedPanel, type FreeUnlockPrompt } from '../../components/LockedPanel'
import { MessageGroupItem } from '../../components/MessageGroupItem'
import { useCountUp } from '../../components/useCountUp'
import type { WordCloudEditor } from '../../components/useEditableWordCloud'
import { useModalDismiss } from '../../components/useModalDismiss'
import { usePaginatedReveal } from '../../components/usePaginatedReveal'
import type { ShellCopy } from '../../copy/shellCopy'
import { splitLeadingEmoji } from '../../lib/format'
import { isParticipantBarChart } from '../../lib/metrics'
import type { ChartData, ChatMessage, MetricCard } from '../../types'
import { ChevronIcon, SearchIcon } from './icons'

/** Estas familias de gráfico son anchas por naturaleza: el heatmap anual tiene
 * 53 columnas y pueden ser más según el rango del chat. En 320px encogerlos los
 * vuelve ilegibles, así que se dejan a su ancho natural dentro de un contenedor
 * que se desliza. El horario no entra acá: son siempre 24 barras de ancho fluido
 * (ver chart-hour-bars en base.css), pensadas para encajar sin scroll. */
const WIDE_CHARTS = new Set(['yearHeatmap', 'monthHeatmap', 'calendarStreak', 'timeline'])

/**
 * El detalle de una métrica, a pantalla completa.
 *
 * Muestra exactamente lo mismo que `MetricModal` en desktop —es el mismo
 * `card.detail`, con los mismos charts y el mismo desglose— pero como hoja que
 * sube desde abajo, y con paso a la métrica siguiente en el pie: en un teléfono,
 * volver a la lista para abrir la que sigue es un viaje de ida y vuelta que no
 * hace falta.
 */
export function MetricSheet({
  card,
  index,
  total,
  copy,
  ai,
  freeUnlock,
  isRevealingFreeUnlock = false,
  overStory = false,
  isSharedStory = false,
  messages,
  wordCloudEditor,
  onClose,
  onPrev,
  onNext,
  onUnlock,
}: {
  card: MetricCard
  index: number
  total: number
  copy: ShellCopy
  ai?: AiPanelProps
  /** Set only where a daily free unlock could actually be spent — see `freeUnlockFor`. */
  freeUnlock?: FreeUnlockPrompt
  /** True for the few seconds right after this card's free unlock was confirmed —
   * see `revealingFreeUnlockId` in useVistazo. */
  isRevealingFreeUnlock?: boolean
  /** Abierta desde el recorrido tipo historia, que queda montado y congelado por
   * debajo. Sube la hoja por encima de esa capa y le saca el paso a la métrica
   * siguiente: acá el detalle pertenece a LA pantalla que el usuario estaba
   * mirando, y cerrarlo lo devuelve justo ahí. */
  overStory?: boolean
  /** True cuando se visualiza desde una historia compartida (usuario anónimo). */
  isSharedStory?: boolean
  /** El chat activo en esta pestaña, si lo hay — ver el mismo prop en
   * MetricModal. Ausente en una historia compartida o en un análisis
   * guardado: esos nunca traen los mensajes crudos, sólo las tarjetas ya
   * calculadas. */
  messages?: ChatMessage[]
  /** Armado por quien llama (ver `wordCloudEditor` en useVistazo, o el propio de
   * SharedStoryView) en vez de acá adentro, así lo buscado sobrevive a que esta
   * hoja se cierre y se reabra — sólo quien llama queda montado toda la sesión. */
  wordCloudEditor: WordCloudEditor
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onUnlock: () => void
}) {
  const groups = usePaginatedReveal()
  const items = usePaginatedReveal()
  const [wordSearch, setWordSearch] = useState('')

  /* La hoja no se desmonta al pasar de métrica —así la animación de entrada no
     se repite en cada paso— así que hay que devolver a cero lo que es por
     métrica: el buscador y los dos contadores de paginado. */
  useEffect(() => {
    setWordSearch('')
    groups.reset()
    items.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  /* Escape, el bloqueo del scroll de fondo y la trampa de foco los pone
     `useModalDismiss`, compartido con los modales de desktop. Lo único propio de
     esta hoja son las flechas. */
  const panelRef = useModalDismiss<HTMLElement>(onClose, {
    onKeyDown: (event) => {
      // Sobre el recorrido no hay paso a la métrica siguiente (ver `overStory`),
      // así que las flechas tampoco lo hacen: moverían la hoja a una métrica que
      // no es la de la pantalla congelada abajo.
      if (overStory) return
      if (event.key === 'ArrowRight') onNext()
      if (event.key === 'ArrowLeft') onPrev()
    },
  })

  const aiBlocked = Boolean(ai && card.ai && card.ai.status !== 'ready')
  const basicLocked = !aiBlocked && card.tier === 'vip' && !card.basic
  const detailLocked = !aiBlocked && !card.detail

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

  function handleWordSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }
    void submitWordSearch()
  }

  const m = copy.mobile
  const heroSplit = card.basic ? splitLeadingEmoji(card.basic.value) : null
  const statValue = useCountUp(heroSplit?.rest ?? '')

  return (
    <div
      className={`m-layer ${overStory ? 'is-over-story' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={card.title}
    >
      <button type="button" className="m-scrim" onClick={onClose} aria-label={copy.close} />

      <section className="m-sheet" ref={panelRef}>
        <span className="m-grabber" aria-hidden="true" />

        <header className="m-sheet-head">
          <div className="m-sheet-title">
            <h2>{card.title}</h2>
            <p>{card.description}</p>
          </div>
          <button type="button" className="m-sheet-close" onClick={onClose} aria-label={copy.close}>
            ✕
          </button>
        </header>

        <div className="m-sheet-body">
          {aiBlocked ? (
            <AiStatePanel state={card.ai!} {...ai!} tall />
          ) : basicLocked ? (
            <LockedPanel preview={card.preview} unlockLabel={copy.unlock} onUnlock={onUnlock} tall />
          ) : card.basic ? (
            <div className="m-sheet-hero">
              <strong>
                {heroSplit?.emoji ? <span className="stat-emoji">{heroSplit.emoji} </span> : null}
                <span className="gradient-text">{statValue}</span>
              </strong>
              <span>{card.basic.label}</span>
              {card.basic.note ? <p className="metric-note">{card.basic.note}</p> : null}
              {card.basic.chart && !heroChartRepeatsBreakdown ? (
                <Chart
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
              ) : null}
            </div>
          ) : null}

          {aiBlocked ? null : (
            <div className="m-sheet-detail">
              <p className="m-section-label">{copy.detailTitle}</p>

              {detailLocked ? (
                <LockedPanel
                  preview={card.preview}
                  unlockLabel={copy.unlock}
                  onUnlock={onUnlock}
                  freeUnlock={freeUnlock}
                  isRevealing={isRevealingFreeUnlock}
                  revealingLabel={copy.freeUnlock.loading}
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

                  {card.detail.chart ? <Chart chart={card.detail.chart} /> : null}

                  {wordCloudEditor.displaySeries && wordCloudEditor.displaySeries.length > 0 ? (
                    <div className="m-series">
                      {wordCloudEditor.displaySeries.map((entry) => (
                        <div className="m-series-item" key={entry.name}>
                          <h4>{entry.name}</h4>
                          <Chart
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
                    <div className="m-block">
                      <p className="m-section-label">{copy.breakdownTitle}</p>
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
                    <div className="m-block">
                      <p className="m-section-label">
                        {card.detail.groupsLabel ?? card.detail.paginatedItemsLabel ?? m.sheet.highlights}
                      </p>
                      {/* Cada grupo se despliega solo, igual que en desktop: en una
                          pantalla chica, abrir los cinco de una llenaría la hoja. */}
                      <div className="message-group-list" ref={groups.setListRef}>
                        {card.detail.groups.slice(0, groups.visibleCount).map((group, position) => (
                          <MessageGroupItem
                            key={group.id}
                            group={group}
                            isNew={groups.revealedFrom !== null && position >= groups.revealedFrom}
                            isSharedStory={isSharedStory}
                            privacyCopy={copy.sharedPrivacy}
                          />
                        ))}
                      </div>
                      {groups.visibleCount < card.detail.groups.length ? (
                        <button type="button" className="ghost-button show-more-button" onClick={groups.showMore}>
                          {copy.showMore} ({groups.visibleCount}/{card.detail.groups.length})
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {card.detail.paginatedItems && card.detail.paginatedItems.length > 0 ? (
                    <div className="m-block">
                      <p className="m-section-label">{card.detail.paginatedItemsLabel ?? copy.detailTitle}</p>
                      <ul className="detail-list" ref={items.setListRef}>
                        {card.detail.paginatedItems.slice(0, items.visibleCount).map((item, position) => (
                          <li
                            key={position}
                            className={items.revealedFrom !== null && position >= items.revealedFrom ? 'is-new' : ''}
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                      {items.visibleCount < card.detail.paginatedItems.length ? (
                        <button type="button" className="ghost-button show-more-button" onClick={items.showMore}>
                          {copy.showMore} ({items.visibleCount}/{card.detail.paginatedItems.length})
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Sobre el recorrido el pie no va: las barras de la historia ya dicen en
            qué pantalla está, y pasar a otra métrica desde acá dejaría la hoja
            mostrando una cosa y el recorrido congelado en otra. */}
        {overStory ? null : (
          <footer className="m-sheet-foot">
            <button
              type="button"
              className="m-sheet-step"
              onClick={onPrev}
              disabled={index === 0}
              aria-label={m.sheet.prev}
            >
              <span className="m-flip">
                <ChevronIcon size={16} />
              </span>
            </button>

            <span className="m-sheet-count">
              {index + 1} / {total}
            </span>

            <button
              type="button"
              className="m-sheet-step"
              onClick={onNext}
              aria-label={index === total - 1 ? m.sheet.backToList : m.sheet.next}
            >
              <ChevronIcon size={16} />
            </button>
          </footer>
        )}
      </section>
    </div>
  )
}

/** Envuelve el gráfico en un contenedor deslizable cuando su familia es más
 * ancha que la pantalla, en vez de dejar que se comprima. */
function Chart({
  chart,
  compact = false,
  wordCloudEditing,
  justAddedWord,
  protectedWords,
}: {
  chart: ChartData
  compact?: boolean
  wordCloudEditing?: WordCloudEditing
  justAddedWord?: string | null
  protectedWords?: string[]
}) {
  if (WIDE_CHARTS.has(chart.kind)) {
    return (
      <div className="m-chart m-scroll-x">
        <div className="m-chart-wide">
          <ChartRenderer
            chart={chart}
            compact={compact}
            wordCloudEditing={wordCloudEditing}
            justAddedWord={justAddedWord}
            protectedWords={protectedWords}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="m-chart">
      <ChartRenderer
        chart={chart}
        compact={compact}
        wordCloudEditing={wordCloudEditing}
        justAddedWord={justAddedWord}
        protectedWords={protectedWords}
      />
    </div>
  )
}
