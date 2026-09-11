import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminInvoices } from './adminApi'
import { count, dateShort, money } from './format'
import { ExportButton, LoadError, Tile } from './parts'
import { useAdminLoad } from './useAdminLoad'

/** Estado con forma además de color, como en el resto del panel. */
const TONE: Record<string, { tone: string; glyph: string }> = {
  aprobado: { tone: 'ok', glyph: '●' },
  pendiente: { tone: 'warn', glyph: '◆' },
  reintentando: { tone: 'warn', glyph: '◆' },
  rechazado: { tone: 'bad', glyph: '▲' },
  devuelto: { tone: 'bad', glyph: '▲' },
}

/** Cobros: cada intento de cobro de todas las cuentas, del más nuevo al más viejo. */
export function InvoicesSection({
  token,
  language,
  copy,
  onOpenUser,
}: {
  token: string
  language: Language
  copy: AdminCopy
  onOpenUser: (id: string) => void
}) {
  const c = copy.invoices
  const [status, setStatus] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAdminLoad(`invoices:${status ?? ''}:${page}`, () => getAdminInvoices(token, status, page))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const counts = Object.entries(data.countsByStatus).sort((a, b) => b[1] - a[1])
  const all = counts.reduce((sum, [, n]) => sum + n, 0)
  const inFlight = (data.countsByStatus['pendiente'] ?? 0) + (data.countsByStatus['reintentando'] ?? 0)
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))

  function pick(next: string | null) {
    setStatus(next)
    setPage(1)
  }

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <div className="adm-grid-4">
        <Tile label={c.approvedMonth} value={money(data.approvedThisMonth, 'ARS', language)}>{c.approvedMonthSub}</Tile>
        <Tile label={c.total} value={count(all, language)}>{c.totalSub}</Tile>
        <Tile label={c.rejected} value={count(data.countsByStatus['rechazado'] ?? 0, language)}>{c.rejectedSub}</Tile>
        <Tile label={c.inFlight} value={count(inFlight, language)}>{c.inFlightSub}</Tile>
      </div>

      <div className="adm-toolbar">
        <div className="adm-chips" role="group" aria-label={c.filterLabel}>
          <button
            type="button"
            className={`adm-chip${status === null ? ' is-on' : ''}`}
            aria-pressed={status === null}
            onClick={() => pick(null)}
          >
            {c.all} · {all}
          </button>
          {counts.map(([key, n]) => (
            <button
              key={key}
              type="button"
              className={`adm-chip${status === key ? ' is-on' : ''}`}
              aria-pressed={status === key}
              onClick={() => pick(key)}
            >
              {c.statuses[key] ?? key} · {n}
            </button>
          ))}
        </div>
        <ExportButton token={token} kind="invoices" copy={copy} />
      </div>

      <section className="adm-card" aria-label={copy.nav.cobros}>
        {data.items.length === 0 ? (
          <p className="adm-muted">{all === 0 ? c.none : c.empty}</p>
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{c.colDate}</th>
                  <th scope="col">{c.colUser}</th>
                  <th scope="col">{c.colStatus}</th>
                  <th scope="col" className="adm-num">{c.colAttempt}</th>
                  <th scope="col" className="adm-num">{c.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{dateShort(item.paidAtUtc ?? item.debitScheduledAtUtc ?? item.createdAtUtc, language)}</td>
                    <td>
                      <button type="button" className="adm-link" onClick={() => onOpenUser(item.userId)}>
                        {item.email}
                      </button>
                    </td>
                    <td>
                      <InvoiceStatus status={item.status} copy={copy} />
                      {item.statusDetail ? <span className="adm-faint"> · {item.statusDetail}</span> : null}
                    </td>
                    <td className="adm-num">{item.attemptNumber}</td>
                    <td className="adm-num">{money(item.amount, item.currencyId, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <div className="adm-pager">
            <button type="button" className="adm-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              {copy.prev}
            </button>
            <span className="adm-faint">{page} / {pages}</span>
            <button type="button" className="adm-button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
              {copy.next}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function InvoiceStatus({ status, copy }: { status: string; copy: AdminCopy }) {
  const style = TONE[status]
  return (
    <span className={`adm-pill${style ? ` is-${style.tone}` : ''}`}>
      {style ? <span aria-hidden="true">{style.glyph}</span> : null}
      {copy.invoices.statuses[status] ?? status}
    </span>
  )
}
