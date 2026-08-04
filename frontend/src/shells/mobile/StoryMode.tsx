import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShellCopy } from '../../copy/shellCopy'
import type { MetricCard } from '../../types'
import { ChevronIcon, LockIcon } from './icons'
import { metricIcon } from './metricIcons'

/** Distancia mínima de arrastre para que cuente como swipe. Por debajo de esto
 * suele ser el temblor de un dedo apoyado, no una intención de avanzar. */
const SWIPE_THRESHOLD = 48

/** La pantalla de cierre no pertenece a ninguna métrica, así que toma el dorado
 * del candado en vez de un acento por métrica. */
const LOCK_ACCENT = 'tier-gold'

/**
 * El recorrido tipo Wrapped: una métrica por pantalla, a pantalla completa.
 *
 * Es lo único del shell de mobile sin equivalente en desktop. Recorre las
 * mismas `interleavedMetrics` que la lista —no recalcula ni reordena nada— y
 * muestra sólo las que tienen un dato real: una pantalla con un esqueleto
 * borroso no es un momento de Wrapped.
 *
 * Las Pro bloqueadas no se intercalan. El recorrido cierra con UNA sola
 * pantalla que dice cuántas quedan, así el usuario gratis ve doce pantallas
 * limpias y un momento de venta al final, en vez de trece candados salteados.
 */
export function StoryMode({
  metrics,
  chatName,
  copy,
  onClose,
  onOpenDetail,
  onUnlock,
}: {
  metrics: MetricCard[]
  chatName: string
  copy: ShellCopy
  onClose: () => void
  onOpenDetail: (card: MetricCard) => void
  onUnlock: () => void
}) {
  const m = copy.mobile.story

  const visible = useMemo(
    () => metrics.filter((card) => card.basic && !(card.ai && card.ai.status !== 'ready')),
    [metrics],
  )
  const lockedCount = useMemo(
    () => metrics.filter((card) => card.tier === 'vip' && !card.basic).length,
    [metrics],
  )

  const hasOutro = lockedCount > 0
  const total = visible.length + (hasOutro ? 1 : 0)

  const [index, setIndex] = useState(0)
  /* De qué lado entra la pantalla nueva. Sin esto la animación era siempre la
     misma subida, así que retroceder se sentía igual que avanzar y el gesto no
     tenía respuesta visual propia. */
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [copied, setCopied] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const isOutro = hasOutro && index >= visible.length
  const card = isOutro ? null : visible[index]

  const goNext = useCallback(() => {
    setDirection('forward')
    setIndex((current) => {
      if (current + 1 >= total) {
        onClose()
        return current
      }
      return current + 1
    })
  }, [total, onClose])

  const goPrev = useCallback(() => {
    setDirection('back')
    setIndex((current) => Math.max(0, current - 1))
  }, [])

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' || event.key === ' ') goNext()
      if (event.key === 'ArrowLeft') goPrev()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKey)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, goNext, goPrev])

  // El aviso de "copiado" se borra solo; si el usuario ya pasó de pantalla,
  // arrastrarlo hasta la siguiente métrica no tendría sentido.
  useEffect(() => {
    setCopied(false)
  }, [index])

  useEffect(() => {
    if (!copied) {
      return
    }
    const timeout = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timeout)
  }, [copied])

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current
    if (!start) {
      return
    }
    touchStart.current = null

    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y

    // Sólo cuenta si el gesto fue claramente horizontal: si no, un scroll
    // vertical con algo de diagonal saltaría de métrica sin querer.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) {
      return
    }

    if (dx < 0) {
      goNext()
    } else {
      goPrev()
    }
  }

  /** Comparte con la hoja nativa del sistema, que es lo que la gente espera en
   * un teléfono. Donde no existe (escritorio, navegadores viejos) cae al
   * portapapeles y lo avisa, en vez de no hacer nada. */
  async function handleShare() {
    if (!card?.basic) {
      return
    }

    const text = `${card.title}: ${card.basic.value} — ${card.basic.label}\n\n${m.shareTag.replace('{chat}', chatName)}`

    try {
      if (navigator.share) {
        await navigator.share({ title: card.title, text })
        return
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Cancelar la hoja de compartir tira una excepción y no es un error:
      // el usuario decidió no compartir, no hay nada que informarle.
    }
  }

  return (
    <div
      className="m-story"
      role="dialog"
      aria-modal="true"
      aria-label={chatName}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="m-story-bars" aria-hidden="true">
        {Array.from({ length: total }, (_, position) => (
          <i key={position} className={position < index ? 'is-done' : position === index ? 'is-now' : ''} />
        ))}
      </div>

      <button type="button" className="m-story-x" onClick={onClose} aria-label={m.exit}>
        ✕
      </button>

      {/* Zonas de toque a los costados, el gesto de siempre en una historia.
          Van detrás del contenido (z-index) para no tapar los botones del pie. */}
      <button type="button" className="m-story-tap is-left" onClick={goPrev} aria-label={m.prev} />
      <button type="button" className="m-story-tap is-right" onClick={goNext} aria-label={m.next} />

      {isOutro ? (
        <div className={`m-story-body is-${direction}`} key="outro">
          <div className={`m-story-plate ${LOCK_ACCENT}`}>
            <span className="m-story-tile" aria-hidden="true">
              <LockIcon size={22} />
            </span>
            <span className="m-story-plate-text">
              <h2 className="m-story-kicker">Vistazo Pro</h2>
              <span className="m-story-count">
                {chatName} · {index + 1} / {total}
              </span>
            </span>
          </div>
          <span className="m-story-rule" aria-hidden="true" />

          <strong className="m-story-huge gradient-text">{lockedCount}</strong>
          <p className="m-story-label">{m.outroTitle}</p>
          <p className="m-story-teaser">{buildTeaser(metrics, lockedCount, m.outroMore)}</p>
        </div>
      ) : card?.basic ? (
        <div className={`m-story-body is-${direction}`} key={card.id}>
          {/* La ficha: el ícono en el color de la métrica, su nombre arriba y el
              contador. Deja el número de abajo como único protagonista — antes
              el título competía con él y el nombre aparecía dos veces. */}
          <div className={`m-story-plate ${card.accent}`}>
            <span className="m-story-tile" aria-hidden="true">
              {metricIcon(card.id)}
            </span>
            <span className="m-story-plate-text">
              <h2 className="m-story-kicker">{card.title}</h2>
              <span className="m-story-count">
                {chatName} · {index + 1} / {total}
              </span>
            </span>
          </div>
          <span className="m-story-rule" aria-hidden="true" />

          <strong className="m-story-huge gradient-text">{card.basic.value}</strong>
          <p className="m-story-label">{card.basic.label}</p>
          {card.basic.note ? <p className="m-story-note">{card.basic.note}</p> : null}

          {/* Pegado a la información, no en el pie: el detalle es una lectura
              más de lo mismo, mientras que compartir es la acción de la pantalla
              y por eso se queda sola con todo el ancho de abajo. */}
          <button type="button" className="m-story-inline" onClick={() => onOpenDetail(card)}>
            {m.detail}
            <ChevronIcon size={14} />
          </button>
        </div>
      ) : null}

      <footer className="m-story-foot">
        {isOutro ? (
          <button type="button" className="primary-button m-full" onClick={onUnlock}>
            {m.outroCta}
          </button>
        ) : (
          <button type="button" className="primary-button m-full" onClick={() => void handleShare()}>
            {copied ? m.copied : m.share}
          </button>
        )}
      </footer>

      {/* Sólo aparece cuando quedan pantallas: en la última el pie ya dice qué
          hacer, y una flecha más sería una salida escondida. */}
      {index + 1 < total ? (
        <span className="m-story-hint" aria-hidden="true">
          <ChevronIcon size={14} />
        </span>
      ) : null}
    </div>
  )
}

/** Nombra unas pocas métricas bloqueadas y resume el resto. Cuatro nombres
 * alcanzan para dar idea de lo que falta; trece serían una lista de precios. */
function buildTeaser(metrics: MetricCard[], lockedCount: number, moreTemplate: string): string {
  const names = metrics
    .filter((card) => card.tier === 'vip' && !card.basic)
    .slice(0, 4)
    .map((card) => card.title)

  const rest = lockedCount - names.length
  const tail = rest > 0 ? ` ${moreTemplate.replace('{n}', String(rest))}` : ''
  return `${names.join(' · ')}${tail}.`
}
