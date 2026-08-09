import { useEffect, useRef, useState, type RefObject } from 'react'
import { prefersReducedMotion } from '../lib/prefersReducedMotion'

/** The first run of digits in a formatted stat, split from whatever text
 * surrounds it — e.g. "12.482 mensajes" → prefix "", number 12482, suffix
 * " mensajes"; "×90" → prefix "×", number 90, suffix "".
 *
 * Every number this app prints comes from one of two places: `Intl.NumberFormat`
 * grouping an integer in 3s, or `.toFixed(1)` printing exactly one decimal
 * digit — never both on the same value. That's what makes "3 digits after the
 * last separator" a safe read as "this is a thousands group" and anything
 * else a decimal point, without having to know which locale produced the
 * string (`formatNumber` in lib/metrics.ts picks '.' for es-AR, ',' for en-US). */
interface AnimatableNumber {
  prefix: string
  suffix: string
  target: number
  decimals: number
  groupChar: string | null
}

const NUMBER_TOKEN = /\d[\d.,]*\d|\d/
const DURATION_MS = 900

function parseAnimatableNumber(value: string): AnimatableNumber | null {
  const match = NUMBER_TOKEN.exec(value)
  if (!match) {
    return null
  }

  const token = match[0]
  const prefix = value.slice(0, match.index)
  const suffix = value.slice(match.index + token.length)
  const lastSeparator = /[.,](\d+)$/.exec(token)

  if (!lastSeparator) {
    return { prefix, suffix, target: parseInt(token, 10), decimals: 0, groupChar: null }
  }

  if (lastSeparator[1].length === 3) {
    const groupChar = token[lastSeparator.index]
    return { prefix, suffix, target: parseInt(token.split(groupChar).join(''), 10), decimals: 0, groupChar }
  }

  return {
    prefix,
    suffix,
    target: parseFloat(token.replace(',', '.')),
    decimals: lastSeparator[1].length,
    groupChar: null,
  }
}

function formatIntermediate(value: number, { decimals, groupChar }: AnimatableNumber): string {
  if (decimals > 0) {
    return value.toFixed(decimals)
  }
  const rounded = String(Math.round(value))
  return groupChar ? rounded.replace(/\B(?=(\d{3})+(?!\d))/g, groupChar) : rounded
}

/** Runs one count-up pass and returns a canceller — callers own cleanup so an
 * unmount mid-animation never calls setState on a gone component. */
function animate(info: AnimatableNumber, onFrame: (text: string) => void, onDone: () => void): () => void {
  const start = performance.now()
  let frame = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / DURATION_MS)
    const eased = 1 - Math.pow(1 - t, 3)
    onFrame(info.prefix + formatIntermediate(info.target * eased, info) + info.suffix)
    frame = t < 1 ? requestAnimationFrame(step) : (onDone(), 0)
  })
  return () => cancelAnimationFrame(frame)
}

/**
 * Counts a formatted stat up from zero the first time it appears, instead of
 * letting it just materialize — the same beat every card in Vistazo already
 * ends on ("×90", "12.482", "38.2%"), just given a running start.
 *
 * Starts as soon as `value` is set. Use this where the number is already
 * fully on-screen the moment it renders — a modal, a story slide — where
 * counting up off-screen would finish before anyone sees it; for a scrolling
 * grid, see `useCountUpOnView`. Values with no leading number ("Búhos") or
 * when the OS asks for less motion just render as-is.
 */
export function useCountUp(value: string): string {
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const info = parseAnimatableNumber(value)
    if (!info || prefersReducedMotion()) {
      setDisplay(value)
      return
    }
    setDisplay(info.prefix + formatIntermediate(0, info) + info.suffix)
    return animate(info, setDisplay, () => setDisplay(value))
  }, [value])

  return display
}

/** Same beat as `useCountUp`, but waits for the element to scroll into view
 * before it starts — for the results grid, which the visitor scrolls past.
 * Plays once per value; re-scrolling a card in and out doesn't recount it. */
export function useCountUpOnView<T extends HTMLElement>(value: string): [string, RefObject<T | null>] {
  const ref = useRef<T>(null)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const info = parseAnimatableNumber(value)
    const node = ref.current
    if (!info || prefersReducedMotion() || !node) {
      setDisplay(value)
      return
    }
    setDisplay(info.prefix + formatIntermediate(0, info) + info.suffix)

    let cancelAnimation: (() => void) | null = null
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect()
          cancelAnimation = animate(info, setDisplay, () => setDisplay(value))
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
      cancelAnimation?.()
    }
  }, [value])

  return [display, ref]
}
