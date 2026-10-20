import { useEffect, useRef } from 'react'

/**
 * El fondo animado del modo historia.
 *
 * Cinco dibujos que se intercalan pantalla por pantalla (ver `storyPatternFor`)
 * sobre los tres colores de siempre —verde, negro y crema— que elige el acento
 * de la métrica (ver `storySchemeFor`). Se dibuja en un canvas detrás de todo y
 * reacciona al dedo: toques, arrastres y el puntero en desktop.
 *
 * Con movimiento reducido se pinta un único cuadro quieto por pantalla.
 */

export type StoryPattern = 'dots' | 'chat' | 'doodles' | 'stripes' | 'blobs'
export type StoryScheme = 'green' | 'black' | 'cream'

const PATTERNS: StoryPattern[] = ['dots', 'chat', 'doodles', 'stripes', 'blobs']

/** Pantallas seguidas nunca repiten dibujo: rotan en orden fijo. */
export function storyPatternFor(index: number): StoryPattern {
  return PATTERNS[index % PATTERNS.length]
}

/* Los mismos grupos que usa mobile.css para los colores de texto (los
   `.m-story:has(.m-story-plate:is(...))`): si cambia uno, cambia el otro. */
const BLACK_ACCENTS = new Set(['tier-purple', 'tier-indigo', 'tier-violet', 'tier-slate', 'tier-blue', 'tier-magenta'])
const CREAM_ACCENTS = new Set(['tier-gold', 'tier-yellow', 'tier-orange', 'tier-rose'])

export function storySchemeFor(accent: string): StoryScheme {
  if (BLACK_ACCENTS.has(accent)) return 'black'
  if (CREAM_ACCENTS.has(accent)) return 'cream'
  return 'green'
}

type Rgba = [number, number, number, number]
type ColorKey = 'bg' | 'pat' | 'pat2' | 'hi'

const PALETTES: Record<StoryScheme, Record<ColorKey, Rgba>> = {
  green: { bg: [30, 215, 96, 1], pat: [10, 102, 42, 0.35], pat2: [10, 102, 42, 0.17], hi: [18, 18, 18, 0.55] },
  black: { bg: [18, 18, 18, 1], pat: [30, 215, 96, 0.16], pat2: [30, 215, 96, 0.08], hi: [30, 215, 96, 0.85] },
  cream: { bg: [246, 242, 232, 1], pat: [221, 211, 187, 1], pat2: [231, 223, 204, 1], hi: [30, 215, 96, 0.9] },
}

const SCHEME_FADE_S = 0.45
const PATTERN_FADE_S = 0.5

interface Engine {
  W: number
  H: number
  dpr: number
  t: number
  pointer: { x: number; y: number; on: boolean; down: boolean; dx: number }
  taps: { x: number; y: number; t: number }[]
  scheme: StoryScheme
  prevScheme: StoryScheme
  schemeMix: number
  /** Cuándo empezó cada fundido, en segundos de reloj: así dura lo mismo aunque
   * el teléfono dibuje a pocos cuadros por segundo. */
  schemeAt: number
  pattern: StoryPattern
  prevPattern: StoryPattern
  patternMix: number
  patternAt: number
  /** Estado propio de cada dibujo; se descarta al cambiar de tamaño. */
  local: Partial<Record<StoryPattern, Record<string, unknown>>>
  doodles: Partial<Record<StoryScheme, HTMLImageElement>>
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function color(e: Engine, key: ColorKey, mult = 1): string {
  const a = PALETTES[e.prevScheme][key]
  const b = PALETTES[e.scheme][key]
  const c = a.map((v, i) => lerp(v, b[i], e.schemeMix))
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] * mult).toFixed(3)})`
}

/** Una burbuja de chat con su piquito arriba, del lado que corresponde. */
function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, side: 'in' | 'out') {
  const r = Math.min(14, h / 2)
  ctx.beginPath()
  if (side === 'in') {
    ctx.moveTo(x - 7, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + 9)
  } else {
    ctx.moveTo(x + w + 7, y)
    ctx.lineTo(x + r, y)
    ctx.arcTo(x, y, x, y + r, r)
    ctx.lineTo(x, y + h - r)
    ctx.arcTo(x, y + h, x + r, y + h, r)
    ctx.lineTo(x + w - r, y + h)
    ctx.arcTo(x + w, y + h, x + w, y + h - r, r)
    ctx.lineTo(x + w, y + 9)
  }
  ctx.closePath()
}

/** Lee el fondo de dibujitos de la app (`--vz-doodles`) y lo recolorea para
 * cada esquema, al doble de resolución para que no se vea borroso. */
function loadDoodles(e: Engine) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vz-doodles')
  // El SVG del token usa comillas simples en sus atributos: el corte es la doble.
  const match = raw.match(/data:image\/svg\+xml,([^"]+)/)
  if (!match) return
  const svg = decodeURIComponent(match[1])
  const size = Number(svg.match(/width='(\d+)'/)?.[1] ?? 420)
  for (const scheme of Object.keys(PALETTES) as StoryScheme[]) {
    const [r, g, b, a] = PALETTES[scheme].pat
    const tinted = svg
      .replace(/stroke='[^']*'/, `stroke='rgb(${r},${g},${b})' stroke-opacity='${Math.min(1, a * 1.6)}'`)
      .replace(`width='${size}' height='${size}'`, `width='${size * 2}' height='${size * 2}'`)
    const img = new Image()
    img.src = `data:image/svg+xml,${encodeURIComponent(tinted)}`
    e.doodles[scheme] = img
  }
}

type Local = Record<string, unknown>

interface Design {
  draw: (ctx: CanvasRenderingContext2D, e: Engine, s: Local, t: number, dt: number, alpha: number) => void
  tap?: (e: Engine, s: Local, x: number, y: number) => void
}

const DESIGNS: Record<StoryPattern, Design> = {
  /* Lunares que respiran en una ola; el dedo los agranda y un toque abre una onda. */
  dots: {
    draw(ctx, e, _s, t) {
      const sp = 46
      const base = 7.5
      ctx.fillStyle = color(e, 'pat')
      for (let row = -1, y = -sp; y < e.H + sp; row++, y += sp * 0.87) {
        for (let x = (row & 1 ? sp / 2 : 0) - sp; x < e.W + sp; x += sp) {
          let k = 0.72 + 0.42 * (0.5 + 0.5 * Math.sin(t * 1.7 - (x * 0.6 + y) * 0.018))
          if (e.pointer.on) k += 0.95 * clamp(1 - Math.hypot(x - e.pointer.x, y - e.pointer.y) / 110)
          for (const tap of e.taps) {
            const age = t - tap.t
            const d = Math.hypot(x - tap.x, y - tap.y)
            k += 1.1 * clamp(1 - Math.abs(d - age * 430) / 42) * clamp(1 - age / 1.4)
          }
          ctx.beginPath()
          ctx.arc(x, y, base * k, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    },
  },

  /* Una conversación sin fin que sube despacio; un toque la acelera. */
  chat: {
    draw(ctx, e, s, _t, dt) {
      type Bubble = { x: number; y: number; w: number; h: number; side: 'in' | 'out'; lines: number; r: number }
      const spawn = () => {
        const seed = s.seed as number
        s.seed = seed + 4
        const side = hash(seed) < 0.5 ? 'in' : 'out'
        const lines = hash(seed + 2) < 0.3 ? 2 : 1
        const w = 74 + hash(seed + 1) * (e.W * 0.5)
        const h = lines === 2 ? 52 : 32
        const x = side === 'in' ? 18 + hash(seed + 2) * 10 : e.W - w - 18 - hash(seed + 2) * 10
        ;(s.items as Bubble[]).push({ x, y: s.yNext as number, w, h, side, lines, r: hash(seed + 1) })
        s.yNext = (s.yNext as number) + h + 10 + (hash(seed + 3) < 0.25 ? 16 : 0)
      }
      if (!s.items) {
        Object.assign(s, { items: [], speed: 0, yNext: 20, seed: 1 })
        while ((s.yNext as number) < e.H + 60) spawn()
      }
      s.speed = lerp(s.speed as number, 0, clamp(dt * 2.2))
      const v = (22 + (s.speed as number)) * dt
      let items = s.items as Bubble[]
      for (const b of items) b.y -= v
      s.yNext = (s.yNext as number) - v
      items = s.items = items.filter((b) => b.y + b.h > -20)
      while ((s.yNext as number) < e.H + 60) spawn()

      for (const b of items) {
        const hover =
          e.pointer.on && e.pointer.x > b.x && e.pointer.x < b.x + b.w && e.pointer.y > b.y && e.pointer.y < b.y + b.h
        ctx.fillStyle = hover ? color(e, 'hi', 0.45) : b.side === 'in' ? color(e, 'pat') : color(e, 'pat2', 1.6)
        bubblePath(ctx, b.x, b.y, b.w, b.h, b.side)
        ctx.fill()
        // Renglones de "texto" y la hora, en el color del fondo.
        ctx.fillStyle = color(e, 'bg', 0.45)
        const lw = b.w - 26
        ctx.fillRect(b.x + 12, b.y + 12, lw * (0.6 + 0.4 * b.r), 4)
        if (b.lines === 2) ctx.fillRect(b.x + 12, b.y + 24, lw * 0.55, 4)
        ctx.fillRect(b.x + b.w - 30, b.y + b.h - 10, 18, 3)
      }
    },
    tap(_e, s) {
      s.speed = ((s.speed as number) ?? 0) + 520
    },
  },

  /* Los dibujitos de la app en dos capas con paralaje. */
  doodles: {
    draw(ctx, e, s, t, dt, alpha) {
      if (!s.off) Object.assign(s, { off: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, par: { x: 0, y: 0 } })
      const off = s.off as { x: number; y: number }
      const vel = s.vel as { x: number; y: number }
      const par = s.par as { x: number; y: number }
      off.x += vel.x * dt
      off.y += vel.y * dt
      vel.x = lerp(vel.x, 0, clamp(dt * 2))
      vel.y = lerp(vel.y, 0, clamp(dt * 2))
      const tx = e.pointer.on ? e.pointer.x / e.W - 0.5 : 0
      const ty = e.pointer.on ? e.pointer.y / e.H - 0.5 : 0
      par.x = lerp(par.x, tx, clamp(dt * 4))
      par.y = lerp(par.y, ty, clamp(dt * 4))

      const layer = (scale: number, speed: number, depth: number, layerAlpha: number) => {
        const passes: [StoryScheme, number][] = [
          [e.prevScheme, 1 - e.schemeMix],
          [e.scheme, e.schemeMix],
        ]
        for (const [scheme, mix] of passes) {
          const img = e.doodles[scheme]
          if (!img?.complete || !img.naturalWidth || mix <= 0) continue
          const pattern = ctx.createPattern(img, 'repeat')
          if (!pattern) continue
          const ox = t * 9 * speed + off.x * depth - par.x * 40 * depth
          const oy = t * 6 * speed + off.y * depth - par.y * 40 * depth
          pattern.setTransform(new DOMMatrix().translate(ox, oy).scale(scale / 2))
          ctx.globalAlpha = alpha * mix * layerAlpha
          ctx.fillStyle = pattern
          ctx.fillRect(0, 0, e.W, e.H)
        }
        ctx.globalAlpha = alpha
      }
      layer(0.55, 0.5, 0.5, 0.55)
      layer(0.85, 1, 1, 1)
    },
    tap(e, s, x, y) {
      const vel = s.vel as { x: number; y: number } | undefined
      if (!vel) return
      const dx = e.W / 2 - x
      const dy = e.H / 2 - y
      const d = Math.hypot(dx, dy) || 1
      vel.x += (dx / d) * 260
      vel.y += (dy / d) * 260
    },
  },

  /* Bandas diagonales que se deslizan; arrastrar cambia su velocidad y sentido. */
  stripes: {
    draw(ctx, e, s, t, dt) {
      if (s.v === undefined) Object.assign(s, { v: 34, offset: 0 })
      let v = s.v as number
      if (e.pointer.down && e.pointer.dx) {
        v = lerp(v, e.pointer.dx / Math.max(dt, 0.001), 0.35)
        e.pointer.dx = 0
      }
      v = lerp(v, Math.sign(v || 1) * 34, clamp(dt * 1.2))
      s.v = v
      s.offset = (s.offset as number) + v * dt

      const L = Math.hypot(e.W, e.H)
      const P = 168
      ctx.save()
      ctx.translate(e.W / 2, e.H / 2)
      ctx.rotate(-0.42)
      const off = (((s.offset as number) % P) + P) % P
      const n = Math.ceil(L / P) + 1
      for (let k = -n; k <= n; k++) {
        const x = k * P + off
        const breathe = Math.sin(t * 1.3 + k) * 6
        ctx.fillStyle = color(e, 'pat')
        ctx.fillRect(x, -L / 2, 56 + breathe, L)
        ctx.fillStyle = color(e, 'pat2', 1.3)
        ctx.fillRect(x + 76 + breathe, -L / 2, 16, L)
        ctx.fillStyle = color(e, 'pat')
        ctx.fillRect(x + 108 + breathe, -L / 2, 5, L)
      }
      ctx.restore()
    },
    tap(_e, s) {
      s.v = ((s.v as number) >= 0 ? 1 : -1) * 600
    },
  },

  /* Manchas grandes y suaves; una sigue al dedo y un toque las hace latir. */
  blobs: {
    draw(ctx, e, s, t, dt) {
      if (!s.follow) Object.assign(s, { pulse: 0, follow: { x: e.W * 0.5, y: e.H * 0.6 } })
      s.pulse = lerp(s.pulse as number, 0, clamp(dt * 2.4))
      const follow = s.follow as { x: number; y: number }
      if (e.pointer.on) {
        follow.x = lerp(follow.x, e.pointer.x, clamp(dt * 5))
        follow.y = lerp(follow.y, e.pointer.y, clamp(dt * 5))
      }
      const blobs: [number, number, number, number, number, ColorKey, number][] = [
        [0.2, 0.25, 0.31, 0.23, 0, 'pat', 1.6],
        [0.75, 0.3, 0.19, 0.27, 1.3, 'hi', 0.32],
        [0.35, 0.75, 0.27, 0.15, 2.1, 'pat', 1.4],
        [0.8, 0.82, 0.23, 0.21, 3.4, 'pat2', 2.2],
        [0.5, 0.5, 0.13, 0.17, 4.2, 'hi', 0.22],
      ]
      blobs.forEach(([cx, cy, ax, ay, phase, key, mult], i) => {
        let x = e.W * (cx + 0.22 * Math.sin(t * ax + phase))
        let y = e.H * (cy + 0.14 * Math.cos(t * ay + phase * 1.3))
        if (i === 1 && e.pointer.on) {
          x = lerp(x, follow.x, 0.85)
          y = lerp(y, follow.y, 0.85)
        }
        const R = e.W * (0.48 + 0.12 * Math.sin(t * 0.7 + phase)) * (1 + (s.pulse as number) * 0.35)
        const g = ctx.createRadialGradient(x, y, 0, x, y, R)
        g.addColorStop(0, color(e, key, mult))
        g.addColorStop(0.55, color(e, key, mult * 0.55))
        g.addColorStop(1, color(e, key, 0))
        ctx.fillStyle = g
        ctx.fillRect(0, 0, e.W, e.H)
      })
    },
    tap(_e, s) {
      s.pulse = 1
    },
  },
}

export function StoryBackdrop({
  pattern,
  scheme,
  paused,
  reducedMotion,
}: {
  pattern: StoryPattern
  scheme: StoryScheme
  /** Hay otra capa encima: se deja de animar para no gastar batería de fondo. */
  paused: boolean
  reducedMotion: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const drawRef = useRef<(dt: number) => void>(() => {})

  if (!engineRef.current) {
    engineRef.current = {
      W: 0,
      H: 0,
      dpr: 1,
      t: 0,
      pointer: { x: 0, y: 0, on: false, down: false, dx: 0 },
      taps: [],
      scheme,
      prevScheme: scheme,
      schemeMix: 1,
      schemeAt: 0,
      pattern,
      prevPattern: pattern,
      patternMix: 1,
      patternAt: 0,
      local: {},
      doodles: {},
    }
  }

  // Cambio de pantalla: el dibujo y el color anteriores se funden con los nuevos.
  useEffect(() => {
    const e = engineRef.current!
    if (scheme !== e.scheme) {
      e.prevScheme = e.scheme
      e.scheme = scheme
      e.schemeMix = reducedMotion ? 1 : 0
      e.schemeAt = performance.now() / 1000
    }
    if (pattern !== e.pattern) {
      e.prevPattern = e.pattern
      e.pattern = pattern
      e.patternMix = reducedMotion ? 1 : 0
      e.patternAt = performance.now() / 1000
    }
    if (reducedMotion) drawRef.current(0)
  }, [pattern, scheme, reducedMotion])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return
    const e = engineRef.current!
    loadDoodles(e)

    const draw = (dt: number) => {
      if (e.schemeMix < 1) e.schemeMix = clamp((performance.now() / 1000 - e.schemeAt) / SCHEME_FADE_S)
      if (e.patternMix < 1) e.patternMix = clamp((performance.now() / 1000 - e.patternAt) / PATTERN_FADE_S)
      e.taps = e.taps.filter((tap) => e.t - tap.t < 2.2)
      ctx.setTransform(e.dpr, 0, 0, e.dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.fillStyle = color(e, 'bg')
      ctx.fillRect(0, 0, e.W, e.H)
      const layers: [StoryPattern, number][] =
        e.patternMix < 1 && e.prevPattern !== e.pattern
          ? [
              [e.prevPattern, 1 - e.patternMix],
              [e.pattern, e.patternMix],
            ]
          : [[e.pattern, 1]]
      for (const [name, alpha] of layers) {
        ctx.save()
        ctx.globalAlpha = alpha
        DESIGNS[name].draw(ctx, e, (e.local[name] ??= {}), e.t, dt, alpha)
        ctx.restore()
      }
    }
    drawRef.current = draw

    const resize = () => {
      e.dpr = Math.min(2, window.devicePixelRatio || 1)
      e.W = host.clientWidth
      e.H = host.clientHeight
      canvas.width = Math.round(e.W * e.dpr)
      canvas.height = Math.round(e.H * e.dpr)
      e.local = {}
      draw(0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    // Con movimiento reducido el fondo queda quieto: ni loop ni gestos.
    if (reducedMotion) {
      // Las imágenes de dibujitos cargan después del primer cuadro.
      const images = Object.values(e.doodles)
      images.forEach((img) => img.addEventListener('load', () => draw(0)))
      return () => observer.disconnect()
    }

    const point = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    let downAt: { x: number; y: number } | null = null
    const onMove = (event: PointerEvent) => {
      const p = point(event)
      if (e.pointer.on) e.pointer.dx += p.x - e.pointer.x
      Object.assign(e.pointer, p, { on: true })
    }
    const onDown = (event: PointerEvent) => {
      const p = point(event)
      downAt = p
      Object.assign(e.pointer, p, { on: true, down: true, dx: 0 })
    }
    const onUp = (event: PointerEvent) => {
      e.pointer.down = false
      if (event.pointerType !== 'mouse') e.pointer.on = false
      if (!downAt) return
      const p = point(event)
      downAt = null
      e.taps.push({ x: p.x, y: p.y, t: e.t })
      DESIGNS[e.pattern].tap?.(e, (e.local[e.pattern] ??= {}), p.x, p.y)
    }
    const onLeave = () => {
      e.pointer.on = false
      e.pointer.down = false
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onLeave)
    host.addEventListener('pointerleave', onLeave)

    return () => {
      observer.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onLeave)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [reducedMotion])

  // El loop corre sólo mientras el recorrido está a la vista.
  useEffect(() => {
    if (reducedMotion || paused) return
    const e = engineRef.current!
    let last = 0
    let raf = requestAnimationFrame(function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now
      e.t = now / 1000
      drawRef.current(dt)
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [paused, reducedMotion])

  return <canvas ref={canvasRef} className="m-story-backdrop" aria-hidden="true" />
}
