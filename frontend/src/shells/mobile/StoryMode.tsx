import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// NUEVO: números que laten — para revertir, borrar este import y los usos de
// useCountUp más abajo (volver a heroSplit?.rest y lockedCount directos).
import { useCountUp } from '../../components/useCountUp'
import type { ShellCopy } from '../../copy/shellCopy'
import { splitLeadingEmoji } from '../../lib/format'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import type { MetricCard } from '../../types'
import { ChevronIcon } from './icons'
// NUEVO: la mascota con humor — para revertir, borrar este import, el de
// mascotMood, y el <MascotBlob> más abajo.
import { MascotBlob } from './MascotBlob'
import { mascotMoodFor } from './mascotMood'

/** Distancia mínima de arrastre para que cuente como swipe. Por debajo de esto
 * suele ser el temblor de un dedo apoyado, no una intención de avanzar. */
const SWIPE_THRESHOLD = 48

/** Cuánto dura cada pantalla antes de pasar sola, como en Instagram. */
const STORY_DURATION_MS = 6000

/** Cuánto tiene que durar un toque quieto para contar como "mantener apretado"
 * y no como el principio de un tap o un swipe. */
const HOLD_DELAY_MS = 180

/** Si el dedo se mueve más que esto antes de cumplirse HOLD_DELAY_MS, es un
 * swipe en curso, no una espera: se cancela el temporizador de hold. */
const MOVE_CANCEL_PX = 10

/** Cuánto dura el latido de "escribiendo..." antes de que aparezca el número. */
const TYPING_REVEAL_MS = 550

/** Cada cuánto rota el nombre de la métrica bloqueada en la pantalla de cierre. */
const TICKER_INTERVAL_MS = 900

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
  const lockedNames = useMemo(
    () => metrics.filter((card) => card.tier === 'vip' && !card.basic).map((card) => card.title),
    [metrics],
  )

  const hasOutro = lockedCount > 0
  const total = visible.length + (hasOutro ? 1 : 0)

  /* Se lee una sola vez: nadie cambia esta preferencia a mitad de un recorrido
     de doce pantallas. */
  const [reducedMotion] = useState(() => prefersReducedMotion())

  const [index, setIndex] = useState(0)
  /* De qué lado entra la pantalla nueva. Sin esto la animación era siempre la
     misma subida, así que retroceder se sentía igual que avanzar y el gesto no
     tenía respuesta visual propia. */
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [copied, setCopied] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  /* El recorrido tipo Wrapped: cada pantalla pasa sola pasado STORY_DURATION_MS,
     salvo que el usuario la mantenga apretada. `elapsed` sobrevive a la pausa —
     por eso vive en un ref y no en el progreso mismo — así reanudar no reinicia
     la barra desde cero. */
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const elapsedRef = useRef(0)
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdEngagedRef = useRef(false)

  /* El latido de "escribiendo..." antes de revelar el número — con movimiento
     reducido no tiene sentido hacer esperar al usuario para nada. */
  const [revealed, setRevealed] = useState(reducedMotion)
  const [tickerIndex, setTickerIndex] = useState(0)

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

  useEffect(() => {
    return () => clearHoldTimeout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El aviso de "copiado" se borra solo; si el usuario ya pasó de pantalla,
  // arrastrarlo hasta la siguiente métrica no tendría sentido.
  useEffect(() => {
    setCopied(false)
  }, [index])

  // Pantalla nueva, cronómetro nuevo: sin esto, pasar de pantalla con tiempo
  // acumulado la cerraría antes de que el usuario llegue a verla.
  useEffect(() => {
    elapsedRef.current = 0
    setProgress(0)
  }, [index])

  // El número arranca oculto detrás de los puntitos y se revela solo — un latido
  // corto, no una espera real. En el cierre no hay número que revelar así.
  useEffect(() => {
    if (isOutro || reducedMotion) {
      return
    }
    setRevealed(false)
    const timeout = setTimeout(() => setRevealed(true), TYPING_REVEAL_MS)
    return () => clearTimeout(timeout)
  }, [index, isOutro, reducedMotion])

  // El nombre de la métrica bloqueada rota mientras la pantalla de cierre esté
  // activa, pausada como todo lo demás, y nunca con movimiento reducido — ahí
  // se muestra la lista fija en vez de esto (ver más abajo).
  useEffect(() => {
    if (!isOutro || paused || reducedMotion || lockedNames.length < 2) {
      return
    }
    const interval = setInterval(() => {
      setTickerIndex((current) => (current + 1) % lockedNames.length)
    }, TICKER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isOutro, paused, reducedMotion, lockedNames])

  // El reloj de la pantalla actual. Pausado no arranca nada; al reanudar,
  // retoma desde `elapsedRef` en vez de reiniciar la barra. `index` es
  // dependencia a propósito aunque no se lea directo: es lo que dispara el
  // cronómetro nuevo del efecto de arriba en cada pantalla.
  useEffect(() => {
    if (paused) {
      return
    }

    const start = Date.now()
    const remaining = Math.max(0, STORY_DURATION_MS - elapsedRef.current)
    const timeout = setTimeout(goNext, remaining)

    let raf = requestAnimationFrame(function tick() {
      const currentElapsed = elapsedRef.current + (Date.now() - start)
      setProgress(Math.min(1, currentElapsed / STORY_DURATION_MS))
      raf = requestAnimationFrame(tick)
    })

    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(raf)
      elapsedRef.current += Date.now() - start
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, index, goNext])

  useEffect(() => {
    if (!copied) {
      return
    }
    const timeout = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timeout)
  }, [copied])

  function clearHoldTimeout() {
    if (holdTimeoutRef.current !== null) {
      clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }

    // Si el dedo se queda quieto más de HOLD_DELAY_MS, es un "mantener
    // apretado": pausa el cronómetro hasta que suelte.
    holdEngagedRef.current = false
    clearHoldTimeout()
    holdTimeoutRef.current = setTimeout(() => {
      holdEngagedRef.current = true
      setPaused(true)
    }, HOLD_DELAY_MS)
  }

  function handleTouchMove(event: React.TouchEvent) {
    const start = touchStart.current
    if (!start || holdEngagedRef.current) {
      return
    }

    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y

    // Ya se movió: es un swipe en marcha, no una espera. No tiene que pausar.
    if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
      clearHoldTimeout()
    }
  }

  function handleTouchEnd(event: React.TouchEvent) {
    clearHoldTimeout()

    if (holdEngagedRef.current) {
      holdEngagedRef.current = false
      touchStart.current = null
      setPaused(false)
      // Fue un toque para pausar, no para navegar: que no cuente además como
      // el tap que avanza o retrocede la pantalla.
      event.preventDefault()
      return
    }

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

  const heroSplit = card?.basic ? splitLeadingEmoji(card.basic.value) : null
  const statValue = useCountUp(heroSplit?.rest ?? '') // NUEVO
  const lockedCountValue = useCountUp(isOutro ? String(lockedCount) : '') // NUEVO

  return (
    <div
      className="m-story"
      role="dialog"
      aria-modal="true"
      aria-label={chatName}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="m-story-bars" aria-hidden="true">
        {Array.from({ length: total }, (_, position) => (
          <i key={position} className={position < index ? 'is-done' : position === index ? 'is-now' : ''}>
            {position === index ? <span className="m-story-fill" style={{ width: `${progress * 100}%` }} /> : null}
          </i>
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
          {/* La ficha: una marca de color y el título arriba, el contador debajo.
              Sin ícono — el número de abajo es el único protagonista. */}
          <div className={`m-story-plate ${LOCK_ACCENT}`}>
            <span className="m-story-tick" aria-hidden="true" />
            <h2 className="m-story-kicker">Vistazo Pro</h2>
            <span className="m-story-count">
              {chatName} · {index + 1} / {total}
            </span>
          </div>
          <span className="m-story-rule" aria-hidden="true" />

          {/* ANTES: <strong className="m-story-huge gradient-text">{lockedCount}</strong> */}
          <strong className="m-story-huge gradient-text">{lockedCountValue}</strong>
          <p className="m-story-label">{m.outroTitle}</p>
          {reducedMotion || lockedNames.length === 0 ? (
            <p className="m-story-teaser">{buildTeaser(metrics, lockedCount, m.outroMore)}</p>
          ) : (
            <div className="m-story-ticker-row">
              <span className="m-story-ticker-caption">{m.outroCaption}</span>
              <span className="m-story-ticker-name" key={tickerIndex}>
                {lockedNames[tickerIndex % lockedNames.length]}
              </span>
            </div>
          )}
        </div>
      ) : card?.basic ? (
        <div className={`m-story-body is-${direction}`} key={card.id}>
          {/* La ficha: una marca de color y el título arriba, el contador debajo.
              Sin ícono — el número de abajo es el único protagonista. */}
          <div className={`m-story-plate ${card.accent}`}>
            <span className="m-story-tick" aria-hidden="true" />
            <h2 className="m-story-kicker">{card.title}</h2>
            <span className="m-story-count">
              {chatName} · {index + 1} / {total}
            </span>
          </div>
          <span className="m-story-rule" aria-hidden="true" />

          {revealed ? (
            <>
              <strong className="m-story-huge">
                {heroSplit?.emoji ? <span className="stat-emoji">{heroSplit.emoji} </span> : null}
                {/* ANTES: <span className="gradient-text">{heroSplit?.rest}</span> */}
                <span className="gradient-text">{statValue}</span>
              </strong>
              <p className="m-story-label">{card.basic.label}</p>
              {card.basic.note ? <p className="m-story-note">{card.basic.note}</p> : null}
            </>
          ) : (
            <span className="m-story-typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}

          {/* Pegado a la información, no en el pie: el detalle es una lectura
              más de lo mismo, mientras que compartir es la acción de la pantalla
              y por eso se queda sola con todo el ancho de abajo. */}
          <button type="button" className="m-story-inline" onClick={() => onOpenDetail(card)}>
            {m.detail}
            <ChevronIcon size={14} />
          </button>

          {/* NUEVO: la mascota reacciona a esta métrica puntual — nunca en el
              cierre, que no tiene una métrica propia de la cual tomar el humor. */}
          <MascotBlob mood={mascotMoodFor(card.id)} />
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
