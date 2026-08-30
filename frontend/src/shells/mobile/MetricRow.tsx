import { memo } from 'react'
import type { AiPanelProps } from '../../components/AiStatePanel'
import type { ShellCopy } from '../../copy/shellCopy'
import type { AiMetricStatus, MetricCard } from '../../types'
import { ChevronIcon, CrownIcon, LockIcon, SparkIcon } from './icons'

/**
 * Una métrica, como fila.
 *
 * Reemplaza a `MetricCard` sólo en mobile: misma data exacta —`card.basic.value`,
 * `.label`, `.ai`— con otra forma. La tarjeta de desktop mide 460px de alto, y
 * apilando 25 daban casi 12.000px de scroll.
 *
 * El valor va en su propio renglón, a lo ancho, y no en una columna a la
 * derecha. Es a propósito: `basic.value` no siempre es un número corto — puede
 * ser "Búhos", "😂 ×1.243", "4 h 12 min" o el nombre de un participante. Una
 * columna de ancho fijo tendría que reservar lugar para el peor caso y se lo
 * quitaría al título en las otras veinticuatro.
 *
 * Memoizada, por lo mismo que `MetricCard` en desktop — la lista monta 25
 * y cualquier cambio de estado del shell las redibujaba todas.
 */
export const MetricRow = memo(function MetricRow({
  card,
  copy,
  ai,
  onOpen,
  revealDelayMs,
}: {
  card: MetricCard
  copy: ShellCopy
  /** Sólo llega para quien tiene Pro; para el resto es indefinido. */
  ai?: AiPanelProps
  onOpen: (card: MetricCard) => void
  /** Escalona la entrada de la fila al montar la lista (ver MetricList). */
  revealDelayMs?: number
}) {
  /* "Pro pero la IA todavía no dio veredicto" no es lo mismo que "no es Pro":
     el primero ya pagó, así que se le explica el estado en vez de venderle nada.
     El `ai &&` es la parte que distingue los dos casos — sin él, alguien sin Pro
     veía "Analizando con IA" en una métrica que en realidad tiene bloqueada. */
  const aiBlocked = Boolean(ai && card.ai && card.ai.status !== 'ready')
  const locked = !aiBlocked && card.tier === 'vip' && !card.basic

  return (
    <button
      type="button"
      className={`m-row ${card.accent} ${locked ? 'is-locked' : ''} ${aiBlocked ? 'is-ai' : ''}`}
      style={revealDelayMs ? { animationDelay: `${revealDelayMs}ms` } : undefined}
      onClick={() => onOpen(card)}
    >
      <span className="m-row-head">
        <span className="m-row-dot" aria-hidden="true" />
        <span className="m-row-title">{card.title}</span>
        {/* La corona sólo cuando la Pro está desbloqueada. Si está bloqueada la
            chapa ya dice VIP, y las dos juntas es el mismo dato dos veces. */}
        {card.tier === 'vip' && !locked ? (
          <span className="m-row-crown" aria-hidden="true">
            <CrownIcon />
          </span>
        ) : null}
        {locked || aiBlocked ? null : (
          <span className="m-row-chevron" aria-hidden="true">
            <ChevronIcon size={15} />
          </span>
        )}
      </span>

      {aiBlocked ? (
        <AiRowState state={card.ai!.status} copy={copy} />
      ) : locked ? (
        <>
          {/* Esqueleto, no el número real difuminado: un blur se puede revertir
              con las herramientas del navegador, y sobre todo insinúa un dato
              que este usuario no compró. Es el mismo lenguaje que LockedPanel
              usa en desktop. */}
          <span className="m-row-skeleton" aria-hidden="true">
            <i style={{ width: '62%' }} />
            <i style={{ width: '38%' }} />
          </span>
          <span className="m-row-chip">
            <LockIcon size={11} />
            VIP
          </span>
        </>
      ) : card.basic ? (
        <>
          <span className="m-row-value">{card.basic.value}</span>
          <span className="m-row-label">{card.basic.label}</span>
        </>
      ) : null}
    </button>
  )
})

/** Versión mínima de `AiStatePanel` para la fila. El panel completo, con el
 * botón de reintentar y la cuenta regresiva, aparece al abrir la métrica. */
function AiRowState({ state, copy }: { state: AiMetricStatus; copy: ShellCopy }) {
  // `ready` no llega acá — la fila ya mostró el valor — pero el tipo lo incluye.
  if (state === 'ready') {
    return null
  }

  const label = {
    pending: copy.ai.pendingTitle,
    consent: copy.ai.consentTitle,
    unavailable: copy.ai.unavailableTitle,
    failed: copy.ai.failedTitle,
  }[state]

  return (
    <>
      <span className="m-row-skeleton" aria-hidden="true">
        <i style={{ width: '54%' }} />
      </span>
      {/* Mismo destello y mismo cyan que `AiStatePanel` en desktop: es la marca
          de "esto lo resuelve la IA", y tenerla en ámbar acá la hacía leer como
          una advertencia. */}
      <span className={`m-row-ai is-${state}`}>
        <span className="m-row-ai-icon">
          <SparkIcon size={13} />
        </span>
        {label}
      </span>
    </>
  )
}
