import { createContext, useContext, type ReactNode } from 'react'
import type { Placement } from '@floating-ui/dom'

export interface TooltipContextValue {
  show: (anchor: HTMLElement, content: ReactNode, placement: Placement) => void
  hide: (anchor: HTMLElement) => void
  toggle: (anchor: HTMLElement, content: ReactNode, placement: Placement) => void
}

export const TooltipContext = createContext<TooltipContextValue | null>(null)

export function useTooltipController(): TooltipContextValue {
  const ctx = useContext(TooltipContext)
  if (!ctx) {
    throw new Error('useTooltipController must be used within a TooltipProvider')
  }
  return ctx
}
