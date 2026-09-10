import type { AdminCopy } from '../copy/adminCopy'
import type { UrgencySeverity } from './types'

/** Estados de suscripción con forma además de color: un glifo por gravedad, nunca color solo. */
const STATUS_TONE: Record<string, { tone: string; glyph: string }> = {
  activa: { tone: 'ok', glyph: '●' },
  pago_fallido: { tone: 'bad', glyph: '▲' },
  pendiente: { tone: 'warn', glyph: '◆' },
}

export function StatusPill({ status, copy }: { status: string; copy: AdminCopy }) {
  const style = STATUS_TONE[status]
  return (
    <span className={`adm-pill${style ? ` is-${style.tone}` : ''}`}>
      {style ? <span aria-hidden="true">{style.glyph}</span> : null}
      {copy.statuses[status] ?? status}
    </span>
  )
}

const SEVERITY: Record<UrgencySeverity, { tone: string; glyph: string }> = {
  critical: { tone: 'bad', glyph: '▲' },
  warning: { tone: 'warn', glyph: '◆' },
  info: { tone: 'info', glyph: '●' },
}

export function SeverityPill({ severity, copy }: { severity: UrgencySeverity; copy: AdminCopy }) {
  const style = SEVERITY[severity]
  return (
    <span className={`adm-pill is-${style.tone}`}>
      <span aria-hidden="true">{style.glyph}</span>
      {copy.urgencies.severity[severity]}
    </span>
  )
}

export function LoadError({ copy, message, onRetry }: { copy: AdminCopy; message: string; onRetry: () => void }) {
  return (
    <div className="adm-card adm-error" role="alert">
      <p>{copy.genericError}</p>
      <p className="adm-muted">{message}</p>
      <button type="button" className="adm-button" onClick={onRetry}>
        {copy.retry}
      </button>
    </div>
  )
}
