import { useEffect, useRef, useState } from 'react'

/**
 * True once the element has scrolled into view — then stays true forever, so a
 * section animates in the first time the visitor reaches it instead of firing
 * (and finishing) on mount, before anyone has scrolled far enough to see it.
 */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || inView || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    )
    observer.observe(node)

    // Belt-and-suspenders: a backgrounded/unfocused tab can delay or skip
    // observer callbacks entirely (browsers throttle work on hidden pages).
    // Content must never end up permanently invisible over that, so force it
    // in after a couple of seconds regardless.
    const fallback = setTimeout(() => setInView(true), 2000)

    return () => {
      observer.disconnect()
      clearTimeout(fallback)
    }
  }, [inView])

  return { ref, inView }
}
