import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clearDevToolbarPosition, getDevToolbarPosition, setDevToolbarPosition, type ToolbarPosition } from '../lib/devFlags'

export interface DevToolbarCopy {
  aiOn: string
  aiOff: string
  aiOnHint: string
  aiOffHint: string
  vipOn: string
  vipOff: string
  vipHint: string
  signInFirst: string
  badge: string
  dragHint: string
}

/** How far the pointer has to move before a press on the grip counts as a drag rather
 * than a click — mostly relevant for touch, where a tap always wiggles a pixel or two. */
const DRAG_THRESHOLD_PX = 3

/**
 * Two switches that only exist on localhost — see `isLocalhost` in lib/devFlags.
 *
 * They solve the two things that make this app annoying to work on: every chat import
 * spends real Gemini tokens, and every look at the Pro experience would otherwise need a
 * real Mercado Pago payment. The VIP switch is backed by an actual (flagged) subscription
 * row rather than a client-side boolean, so the server-side Pro gate is exercised too —
 * a fake that only convinced the UI would hide exactly the bugs worth catching.
 *
 * The whole bar is draggable by its grip handle, because a fixed top-right toolbar
 * inevitably ends up sitting on top of something (the account menu, in this app's case).
 * Position is kept in a ref during the drag and only committed to React state on release,
 * so dragging never fights the re-renders coming from `isBusy`/`isVipSimulated` changing
 * mid-drag.
 */
export function DevToolbar({
  copy,
  isAiDisabled,
  isVipSimulated,
  canToggleVip,
  isBusy,
  onToggleAi,
  onToggleVip,
}: {
  copy: DevToolbarCopy
  isAiDisabled: boolean
  isVipSimulated: boolean
  canToggleVip: boolean
  isBusy: boolean
  onToggleAi: () => void
  onToggleVip: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<ToolbarPosition | null>(() => {
    const stored = getDevToolbarPosition()
    return stored ? clampToViewport(stored) : null
  })
  const [isDragging, setIsDragging] = useState(false)

  // A resize (rotating a tablet, shrinking the window) can strand the bar off-screen or
  // behind the edge — reclamp instead of leaving it somewhere the user can no longer
  // reach to drag back.
  useEffect(() => {
    function handleResize() {
      setPosition((current) => (current ? clampToViewport(current) : current))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  function handleGripPointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    // Only the primary button/touch/pen starts a drag — a right-click should still be
    // able to open a context menu on the handle.
    if (event.button !== 0) {
      return
    }

    // Otherwise the browser's native text-selection drag kicks in on the grip's label
    // and leaves a blue selection highlight trailing the pointer.
    event.preventDefault()

    const container = containerRef.current
    if (!container) {
      return
    }

    const startRect = container.getBoundingClientRect()
    const startPointerX = event.clientX
    const startPointerY = event.clientY
    const grabOffsetX = startPointerX - startRect.left
    const grabOffsetY = startPointerY - startRect.top

    let dragging = false
    let lastPosition: ToolbarPosition = { top: startRect.top, left: startRect.left }

    function applyPosition(next: ToolbarPosition) {
      lastPosition = next
      if (container) {
        container.style.top = `${next.top}px`
        container.style.left = `${next.left}px`
        container.style.right = 'auto'
        container.style.bottom = 'auto'
      }
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      if (!dragging) {
        const movedPx = Math.hypot(moveEvent.clientX - startPointerX, moveEvent.clientY - startPointerY)
        if (movedPx < DRAG_THRESHOLD_PX) {
          return
        }
        dragging = true
        setIsDragging(true)
      }

      const rect = container!.getBoundingClientRect()
      const next = clampToViewport({
        left: moveEvent.clientX - grabOffsetX,
        top: moveEvent.clientY - grabOffsetY,
      }, rect)

      applyPosition(next)
    }

    function handlePointerUp() {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerUp)

      if (dragging) {
        setPosition(lastPosition)
        setDevToolbarPosition(lastPosition)
        setIsDragging(false)
      }
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
  }

  // Snaps back to the default top-right corner — the escape hatch for when a drag lands
  // somewhere inconvenient and there is no other UI to fix it from.
  function handleGripDoubleClick() {
    setPosition(null)
    clearDevToolbarPosition()
  }

  return (
    <div
      ref={containerRef}
      className={`dev-toolbar ${isDragging ? 'is-dragging' : ''}`}
      aria-label="Local development tools"
      style={position ? { top: position.top, left: position.left, right: 'auto', bottom: 'auto' } : undefined}
    >
      <span
        className="dev-toolbar-grip"
        role="button"
        tabIndex={0}
        aria-label={copy.dragHint}
        title={copy.dragHint}
        onPointerDown={handleGripPointerDown}
        onDoubleClick={handleGripDoubleClick}
      >
        <GripIcon />
        {copy.badge}
      </span>

      <button
        type="button"
        className={`dev-toggle ${isAiDisabled ? 'is-off' : 'is-on'}`}
        onClick={onToggleAi}
        title={isAiDisabled ? copy.aiOffHint : copy.aiOnHint}
      >
        <span className="dev-toggle-dot" aria-hidden="true" />
        {isAiDisabled ? copy.aiOff : copy.aiOn}
      </button>

      <button
        type="button"
        className={`dev-toggle ${isVipSimulated ? 'is-on' : 'is-off'}`}
        onClick={onToggleVip}
        disabled={!canToggleVip || isBusy}
        title={canToggleVip ? copy.vipHint : copy.signInFirst}
      >
        <span className="dev-toggle-dot" aria-hidden="true" />
        {isVipSimulated ? copy.vipOff : copy.vipOn}
      </button>
    </div>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 12 20" width={8} height={14} aria-hidden="true">
      {[2, 8, 14].map((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} fill="currentColor" />),
      )}
    </svg>
  )
}

/** Keeps at least a corner of the bar reachable within the viewport, using the container's
 * own measured size when available (falls back to a conservative estimate before first
 * paint, since a brand-new drag has no rect to measure from yet). */
function clampToViewport(position: ToolbarPosition, rect?: DOMRect): ToolbarPosition {
  const width = rect?.width ?? 260
  const height = rect?.height ?? 48
  const maxLeft = Math.max(8, window.innerWidth - width - 8)
  const maxTop = Math.max(8, window.innerHeight - height - 8)

  return {
    left: Math.min(Math.max(position.left, 8), maxLeft),
    top: Math.min(Math.max(position.top, 8), maxTop),
  }
}
