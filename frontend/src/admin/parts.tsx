import { useState, type ReactNode } from 'react'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminExport, type AdminExport } from './adminApi'
import { saveFile } from './download'
import { ADMIN_PERIODS, type AdminCount, type AdminPeriod, type UrgencySeverity } from './types'

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

/** Una cifra con su rótulo. `pending` la marca como algo que todavía no se puede medir. */
export function Tile({ label, value, pending, children }: { label: string; value: string; pending?: boolean; children?: ReactNode }) {
  return (
    <div className={`adm-card adm-tile${pending ? ' is-pending' : ''}`}>
      <span className="adm-tile-label">{label}</span>
      <span className="adm-tile-value">{value}</span>
      {children ? <span className="adm-tile-sub">{children}</span> : null}
    </div>
  )
}

export function PeriodChips({ days, onChange, copy }: { days: AdminPeriod; onChange: (days: AdminPeriod) => void; copy: AdminCopy }) {
  return (
    <div className="adm-chips" role="group" aria-label={copy.periodLabel}>
      {ADMIN_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          className={`adm-chip${period === days ? ' is-on' : ''}`}
          aria-pressed={period === days}
          onClick={() => onChange(period)}
        >
          {copy.periods[period]}
        </button>
      ))}
    </div>
  )
}

/** Un ranking corto: rótulo, una barra relativa al primero y la cantidad. */
export function RankList({ items, label, empty }: { items: AdminCount[]; label: (key: string) => ReactNode; empty: string }) {
  if (items.length === 0) {
    return <p className="adm-muted">{empty}</p>
  }

  const top = Math.max(...items.map((item) => item.count), 1)
  return (
    <ol className="adm-rank">
      {items.map((item) => (
        <li key={item.key}>
          <span className="adm-rank-label">{label(item.key)}</span>
          <span className="adm-rank-bar" aria-hidden="true">
            <span style={{ width: `${(item.count / top) * 100}%` }} />
          </span>
          <span className="adm-rank-count">{item.count}</span>
        </li>
      ))}
    </ol>
  )
}

/** Baja un CSV. Si falla, lo dice al lado del botón: no hay otra pantalla adonde avisarlo. */
export function ExportButton({ token, kind, copy }: { token: string; kind: AdminExport; copy: AdminCopy }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function run() {
    setBusy(true)
    setFailed(false)
    try {
      const day = new Date().toISOString().slice(0, 10)
      saveFile(await getAdminExport(token, kind), `vistazo-${copy.exportNames[kind]}-${day}.csv`)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="adm-export">
      <button type="button" className="adm-button" disabled={busy} onClick={run}>
        {busy ? copy.exporting : copy.exportCsv}
      </button>
      {failed ? (
        <span className="adm-error-text" role="alert">
          {copy.exportFailed}
        </span>
      ) : null}
    </span>
  )
}
