import type { AiPanelProps } from '../../components/AiStatePanel'
import type { ShellCopy } from '../../copy/shellCopy'
import { formatNumber } from '../../lib/metrics'
import type { AnalysisBundle, Language, MetricCard } from '../../types'
import { MetricRow } from './MetricRow'

/**
 * La pestaña de métricas: resumen del chat arriba, las 25 filas abajo.
 *
 * Las tres cifras del resumen van en una tira horizontal en vez del panel de
 * tres columnas de desktop, y los participantes en chips que se deslizan al
 * costado: un grupo de doce personas no entra en dos renglones, pero tampoco
 * merece empujar las métricas media pantalla para abajo.
 */
export function MetricList({
  analysis,
  metrics,
  copy,
  language,
  generatedAt,
  showReprocessHint,
  ai,
  onOpenMetric,
  onStartStory,
}: {
  analysis: AnalysisBundle
  metrics: MetricCard[]
  copy: ShellCopy
  language: Language
  generatedAt: string
  showReprocessHint: boolean
  /** Sólo llega para quien tiene Pro; es lo que distingue "esperando a la IA"
   * de "métrica bloqueada". */
  ai?: AiPanelProps
  onOpenMetric: (card: MetricCard) => void
  onStartStory: () => void
}) {
  const m = copy.mobile
  const lockedCount = metrics.filter((card) => card.tier === 'vip' && !card.basic).length
  const proCount = metrics.filter((card) => card.tier === 'vip').length

  return (
    <>
      <div className="m-summary">
        <div>
          <strong>{formatNumber(analysis.messageCount, language)}</strong>
          <span>{copy.messages}</span>
        </div>
        <div>
          <strong>{formatNumber(analysis.participantCount, language)}</strong>
          <span>{copy.participants}</span>
        </div>
        <div className="m-summary-date">
          <strong>{analysis.dateRangeLabel}</strong>
          <span>{copy.generatedAt}</span>
        </div>
      </div>

      <div className="m-chips m-scroll-x">
        {analysis.participants.map((participant) => (
          <span key={participant} className="participant-chip">
            {participant}
          </span>
        ))}
      </div>

      {showReprocessHint ? <p className="warning-banner">{copy.reprocessHint}</p> : null}

      <div className="m-segment">
        <button type="button" className="is-active">
          {m.list.tabList}
        </button>
        <button type="button" onClick={onStartStory}>
          {m.list.tabStory}
          <span className="m-play" aria-hidden="true">
            ▶
          </span>
        </button>
      </div>

      <p className="m-section-label m-section-split">
        <span>
          {metrics.length} {m.list.metricsCount}
        </span>
        <span>
          {lockedCount > 0
            ? `${lockedCount} ${m.list.lockedCount}`
            : `${proCount} ${m.list.proCount}`}
        </span>
      </p>

      <div className="m-rows">
        {metrics.map((card, index) => (
          <MetricRow
            key={card.id}
            card={card}
            copy={copy}
            ai={ai}
            onOpen={onOpenMetric}
            // Escalonado sólo en las primeras filas — de ahí para abajo esperar
            // a que le toque el turno se siente lento, no elegante.
            revealDelayMs={Math.min(index, 10) * 35}
          />
        ))}
      </div>

      <p className="m-generated">{generatedAt}</p>
    </>
  )
}
