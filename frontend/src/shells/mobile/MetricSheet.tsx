import { useEffect, useMemo, useState } from 'react'
import { AiStatePanel, type AiPanelProps } from '../../components/AiStatePanel'
import { BarRanking } from '../../components/charts/BarRanking'
import { ChartRenderer } from '../../components/charts/ChartRenderer'
import { LockedPanel, type FreeUnlockPrompt } from '../../components/LockedPanel'
import { MessageGroupItem } from '../../components/MessageGroupItem'
// NUEVO: números que laten — para revertir, borrar este import y el uso de
// useCountUp más abajo (volver a mostrar heroSplit?.rest directo).
import { useCountUp } from '../../components/useCountUp'
import { usePaginatedReveal } from '../../components/usePaginatedReveal'
import type { ShellCopy } from '../../copy/shellCopy'
import { splitLeadingEmoji } from '../../lib/format'
import type { ChartData, MetricCard } from '../../types'
import { ChevronIcon } from './icons'

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

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onNext()
      if (event.key === 'ArrowLeft') onPrev()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, onNext, onPrev])

  const aiBlocked = Boolean(ai && card.ai && card.ai.status !== 'ready')
  const basicLocked = !aiBlocked && card.tier === 'vip' && !card.basic
  const detailLocked = !aiBlocked && !card.detail

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

  const m = copy.mobile
  const heroSplit = card.basic ? splitLeadingEmoji(card.basic.value) : null
  const statValue = useCountUp(heroSplit?.rest ?? '') // NUEVO

  return (
    <div className="m-layer" role="dialog" aria-modal="true" aria-label={card.title}>
      <button type="button" className="m-scrim" onClick={onClose} aria-label={copy.close} />

      <section className="m-sheet">
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
                {/* ANTES: <span className="gradient-text">{heroSplit?.rest}</span> */}
                <span className="gradient-text">{statValue}</span>
              </strong>
              <span>{card.basic.label}</span>
              {card.basic.note ? <p className="metric-note">{card.basic.note}</p> : null}
              {card.basic.chart ? <Chart chart={card.basic.chart} /> : null}
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

                  {hasWordCloud ? (
                    <input
                      type="search"
                      className="word-search-input"
                      placeholder={copy.searchPlaceholder}
                      value={wordSearch}
                      onChange={(event) => setWordSearch(event.target.value.toLowerCase())}
                    />
                  ) : null}

                  {filteredDetailChart ? <Chart chart={filteredDetailChart} /> : null}

                  {filteredSeries.length > 0 ? (
                    <div className="m-series">
                      {filteredSeries.map((entry) => (
                        <div className="m-series-item" key={entry.name}>
                          <h4>{entry.name}</h4>
                          <Chart chart={entry.chart} compact />
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
      </section>
    </div>
  )
}

/** Envuelve el gráfico en un contenedor deslizable cuando su familia es más
 * ancha que la pantalla, en vez de dejar que se comprima. */
function Chart({ chart, compact = false }: { chart: ChartData; compact?: boolean }) {
  if (WIDE_CHARTS.has(chart.kind)) {
    return (
      <div className="m-chart m-scroll-x">
        <div className="m-chart-wide">
          <ChartRenderer chart={chart} compact={compact} />
        </div>
      </div>
    )
  }

  return (
    <div className="m-chart">
      <ChartRenderer chart={chart} compact={compact} />
    </div>
  )
}

function filterWordCloud(chart: ChartData, search: string): ChartData {
  if (chart.kind !== 'wordCloud' || !search) {
    return chart
  }
  return { kind: 'wordCloud', words: chart.words.filter((word) => word.word.includes(search)) }
}
