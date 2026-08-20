import { useEffect, useMemo, useState } from 'react'
import { getSharedStory } from '../../lib/api'
import { shellCopy } from '../../copy/shellCopy'
import type { SharedCard, SharedStoryPayload } from '../../lib/shareStory'
import type { MetricCard } from '../../types'
import { MetricSheet } from './MetricSheet'
import { StoryMode } from './StoryMode'
import './mobile.css'

/**
 * Lo que ve quien abre un link compartido, sin instalar nada ni iniciar sesión.
 *
 * Reusa el recorrido y la hoja de detalle tal cual: la gracia del link es que sea
 * la misma experiencia que vio quien lo mandó, no una versión recortada. Por eso
 * el detalle se abre ENCIMA del recorrido acá también — es exactamente el
 * comportamiento que `MobileShell` implementa para el recorrido propio.
 *
 * No hay gate de VIP ni desbloqueos que resolver: el backend ya devolvió sólo lo
 * que el usuario podía ver cuando compartió, congelado. Lo que llega es lo que
 * se muestra.
 */
export function SharedStoryView({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<SharedStoryPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [openMetricId, setOpenMetricId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await getSharedStory(slug)
        if (!cancelled) {
          setPayload(result)
          setStatus('ready')
        }
      } catch {
        // Vencido, inexistente o mal escrito son el mismo caso para quien mira:
        // el link no anda. El backend tampoco los distingue a propósito.
        if (!cancelled) {
          setStatus('gone')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [slug])

  /* El idioma sale del recorrido, no del visitante: las etiquetas vinieron ya
     traducidas desde el backend, así que mostrar el marco en otro idioma dejaría
     títulos en uno y datos en el otro. Mientras carga todavía no se sabe cuál es,
     y español es el idioma por defecto de la app. */
  const copy = shellCopy[payload?.language ?? 'es']
  const s = copy.shared

  /* Las tarjetas compartidas ya vienen sin `note` ni `groups` (ver
     SharePayloadSanitizer.cs). Volver a ponerlos como `undefined` no es adorno:
     es lo que las convierte en el `MetricCard` que StoryMode y MetricSheet
     esperan, sin tener que enseñarles una segunda forma de tarjeta. */
  const metrics: MetricCard[] = useMemo(
    () => (payload ? payload.cards.map(toMetricCard) : []),
    [payload],
  )

  const openMetricIndex = useMemo(
    () => (openMetricId === null ? -1 : metrics.findIndex((card) => card.id === openMetricId)),
    [openMetricId, metrics],
  )
  const openMetric = openMetricIndex >= 0 ? metrics[openMetricIndex] : null

  if (status === 'loading') {
    return (
      <div className="m-shared-state">
        <span className="brand-orb" />
        <p>{s.loading}</p>
      </div>
    )
  }

  if (status === 'gone' || !payload) {
    return (
      <div className="m-shared-state">
        <span className="brand-orb" />
        <h1>{s.goneTitle}</h1>
        <p>{s.goneBody}</p>
        <button type="button" className="primary-button" onClick={() => window.location.assign('/')}>
          {s.cta}
        </button>
      </div>
    )
  }

  return (
    <div className="m-shell">
      <StoryMode
        metrics={metrics}
        chatName={payload.chatName}
        copy={copy}
        suspended={openMetric !== null}
        // Re-compartir es pasar el mismo link: ya existe y es público, así que no
        // hay nada que crear contra el backend.
        share={{ createLink: () => Promise.resolve(window.location.href) }}
        outro={{
          title: s.outroTitle,
          caption: s.outroCaption,
          ctaLabel: s.cta,
          onCta: () => window.location.assign('/'),
        }}
        // Salir de un recorrido compartido no tiene "atrás" al cual volver: quien
        // llegó por el link no tiene la app abierta detrás, tiene la invitación.
        onClose={() => window.location.assign('/')}
        onOpenDetail={(card) => setOpenMetricId(card.id)}
        onUnlock={() => window.location.assign('/')}
      />

      {openMetric ? (
        <MetricSheet
          card={openMetric}
          index={openMetricIndex}
          total={metrics.length}
          copy={copy}
          overStory
          onClose={() => setOpenMetricId(null)}
          // Sin paso a la métrica siguiente sobre el recorrido (ver `overStory`),
          // así que estos nunca se llaman.
          onPrev={() => undefined}
          onNext={() => undefined}
          onUnlock={() => window.location.assign('/')}
        />
      ) : null}
    </div>
  )
}

/** Una tarjeta compartida es un `MetricCard` al que le faltan los campos que
 * describen estados que acá no existen: nunca está bloqueada (sólo se compartió
 * lo visible) ni esperando a la IA (sólo se compartió lo resuelto). */
function toMetricCard(card: SharedCard): MetricCard {
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    tier: card.tier,
    accent: card.accent,
    hasData: true,
    basic: card.basic,
    detail: card.detail,
    // Nunca se renderiza: `preview` es el texto del panel bloqueado, y en un
    // recorrido compartido no hay paneles bloqueados.
    preview: '',
  }
}
