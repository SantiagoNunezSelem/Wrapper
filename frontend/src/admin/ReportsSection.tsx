import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminSupportReports, setAdminSupportReportStatus } from './adminApi'
import { count, dateTime, fill, relative } from './format'
import { LoadError, StatusPill, Tile } from './parts'
import type { AdminSupportReport, AdminSupportReportPage, SupportReportStatus } from './types'
import { useAdminLoad } from './useAdminLoad'

/**
 * Reportes: lo que la gente mandó desde la página de ayuda. Es la bandeja de entrada —
 * no se manda ningún mail—, así que lo nuevo va primero y se cierra desde acá.
 */
export function ReportsSection({
  token,
  language,
  copy,
  onOpenUser,
  now = Date.now(),
}: {
  token: string
  language: Language
  copy: AdminCopy
  onOpenUser: (id: string) => void
  now?: number
}) {
  const r = copy.reports
  // Arranca en lo que falta contestar: es lo único que alguien viene a buscar acá.
  const [status, setStatus] = useState<SupportReportStatus | null>('nuevo')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload, update } = useAdminLoad(`reports:${status ?? ''}:${page}`, () =>
    getAdminSupportReports(token, status, page),
  )

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const open = data.countsByStatus['nuevo'] ?? 0
  const resolved = data.countsByStatus['resuelto'] ?? 0
  const all = open + resolved
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const filters: { id: SupportReportStatus | null; label: string; n: number }[] = [
    { id: 'nuevo', label: r.statuses.nuevo, n: open },
    { id: 'resuelto', label: r.statuses.resuelto, n: resolved },
    { id: null, label: r.all, n: all },
  ]

  function pick(next: SupportReportStatus | null) {
    setStatus(next)
    setPage(1)
  }

  /** Cambia la fila en el lugar y los contadores con ella: volver a pedir la página la
   * sacaría de la vista filtrada justo debajo del click. */
  function applyChange(changed: AdminSupportReport) {
    update((current: AdminSupportReportPage) => {
      const previous = current.items.find((item) => item.id === changed.id)
      const counts = { ...current.countsByStatus }
      if (previous && previous.status !== changed.status) {
        counts[previous.status] = Math.max(0, (counts[previous.status] ?? 0) - 1)
        counts[changed.status] = (counts[changed.status] ?? 0) + 1
      }
      return {
        ...current,
        countsByStatus: counts,
        items: current.items.map((item) => (item.id === changed.id ? changed : item)),
      }
    })
  }

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <div className="adm-grid-3">
        <Tile label={r.open} value={count(open, language)}>{r.openSub}</Tile>
        <Tile label={r.resolved} value={count(resolved, language)}>{r.resolvedSub}</Tile>
        <Tile label={r.total} value={count(all, language)}>{r.totalSub}</Tile>
      </div>

      <div className="adm-chips" role="group" aria-label={r.filterLabel}>
        {filters.map((item) => (
          <button
            key={item.id ?? 'all'}
            type="button"
            className={`adm-chip${status === item.id ? ' is-on' : ''}`}
            aria-pressed={status === item.id}
            onClick={() => pick(item.id)}
          >
            {item.label} · {item.n}
          </button>
        ))}
      </div>

      {data.items.length === 0 ? (
        <p className="adm-card adm-empty">{all === 0 ? r.none : r.empty}</p>
      ) : (
        <ul className="adm-reports">
          {data.items.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              token={token}
              language={language}
              copy={copy}
              now={now}
              onOpenUser={onOpenUser}
              onChanged={applyChange}
            />
          ))}
        </ul>
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
    </div>
  )
}

function ReportCard({
  report,
  token,
  language,
  copy,
  now,
  onOpenUser,
  onChanged,
}: {
  report: AdminSupportReport
  token: string
  language: Language
  copy: AdminCopy
  now: number
  onOpenUser: (id: string) => void
  onChanged: (report: AdminSupportReport) => void
}) {
  const r = copy.reports
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const isOpen = report.status === 'nuevo'
  const ticket = fill(r.ticket, { code: report.ticketCode })
  // El código va en el asunto: es la referencia que la persona ya tiene a la vista.
  const replyHref = `mailto:${report.contactEmail}?subject=${encodeURIComponent(`${r.replySubject} (${ticket})`)}`

  async function toggle() {
    setBusy(true)
    setFailed(false)
    try {
      onChanged(await setAdminSupportReportStatus(token, report.id, isOpen ? 'resuelto' : 'nuevo'))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`adm-card adm-report${isOpen ? ' is-open' : ''}`}>
      <header className="adm-report-head">
        <strong className="adm-report-ticket">{ticket}</strong>
        <span className={`adm-pill${isOpen ? ' is-warn' : ' is-ok'}`}>
          <span aria-hidden="true">{isOpen ? '◆' : '●'}</span>
          {r.statuses[report.status] ?? report.status}
        </span>
        <span className="adm-pill">{r.categories[report.category] ?? report.category}</span>
        <span className="adm-faint" title={dateTime(report.createdAtUtc, language)}>
          {relative(report.createdAtUtc, now, language)}
        </span>
      </header>

      <p className="adm-report-text">{report.description}</p>

      <dl className="adm-facts adm-report-facts">
        <div>
          <dt>{r.contact}</dt>
          <dd>
            <a className="adm-link" href={replyHref}>
              {report.contactEmail}
            </a>
          </dd>
        </div>
        <div>
          <dt>{r.account}</dt>
          <dd>
            <button type="button" className="adm-link" onClick={() => onOpenUser(report.userId)}>
              {report.accountEmail}
            </button>
          </dd>
        </div>
        {report.subscriptionState ? (
          <div>
            <dt>{r.stateThen}</dt>
            <dd>
              <StatusPill status={report.subscriptionState} copy={copy} />
            </dd>
          </div>
        ) : null}
      </dl>

      <details className="adm-report-tech">
        <summary>{r.technical}</summary>
        <dl className="adm-facts">
          <div>
            <dt>{r.browser}</dt>
            <dd className="adm-code">{report.userAgent ?? '—'}</dd>
          </div>
          <div>
            <dt>{r.screen}</dt>
            <dd>{report.viewport ?? '—'}</dd>
          </div>
          <div>
            <dt>{r.language}</dt>
            <dd>{report.language ?? '—'}</dd>
          </div>
        </dl>
      </details>

      <footer className="adm-report-foot">
        {report.resolvedAtUtc ? (
          <span className="adm-faint">
            {fill(r.resolvedBy, { who: report.resolvedByEmail ?? '—', when: relative(report.resolvedAtUtc, now, language) })}
          </span>
        ) : (
          <span />
        )}
        <span className="adm-report-actions">
          <a className="adm-button" href={replyHref}>
            {r.reply}
          </a>
          <button type="button" className={`adm-button${isOpen ? ' is-primary' : ''}`} disabled={busy} onClick={toggle}>
            {busy ? r.saving : isOpen ? r.resolve : r.reopen}
          </button>
        </span>
      </footer>
      {failed ? (
        <p className="adm-error-text" role="alert">
          {r.actionFailed}
        </p>
      ) : null}
    </li>
  )
}
