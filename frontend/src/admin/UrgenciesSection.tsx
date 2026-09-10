import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminUrgencies } from './adminApi'
import { dateShort, fill, relative } from './format'
import { LoadError, SeverityPill } from './parts'
import type { AdminPaymentsHealth, AdminUrgency, UrgencySeverity } from './types'
import { useAdminLoad } from './useAdminLoad'

type Filter = 'all' | UrgencySeverity

/** Urgencias: lo que se rompió o está por romperse, ordenado por gravedad. */
export function UrgenciesSection({
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
  const u = copy.urgencies
  const [filter, setFilter] = useState<Filter>('all')
  const { data, error, loading, reload } = useAdminLoad('urgencies', () => getAdminUrgencies(token))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const bySeverity = (severity: UrgencySeverity) => data.items.filter((item) => item.severity === severity).length
  const visible = filter === 'all' ? data.items : data.items.filter((item) => item.severity === filter)
  const filters: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: u.all, n: data.items.length },
    { id: 'critical', label: u.severity.critical, n: bySeverity('critical') },
    { id: 'warning', label: u.severity.warning, n: bySeverity('warning') },
    { id: 'info', label: u.severity.info, n: bySeverity('info') },
  ]

  return (
    <div className={`adm-grid-inbox${loading ? ' is-refreshing' : ''}`}>
      <div className="adm-stack">
        <div className="adm-chips" role="group" aria-label={u.title}>
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-chip${filter === item.id ? ' is-on' : ''}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} · {item.n}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="adm-card adm-empty">{u.empty}</p>
        ) : (
          <ul className="adm-inbox">
            {visible.map((item, index) => {
              const detail = detailFor(item, copy, language)
              return (
                <li key={`${item.kind}-${item.reference ?? item.userId ?? index}-${item.atUtc}`} className={`adm-item is-${item.severity}`}>
                  <SeverityPill severity={item.severity} copy={copy} />
                  <div className="adm-item-body">
                    <p className="adm-item-title">{titleFor(item, copy)}</p>
                    {detail ? <p className="adm-muted">{detail}</p> : null}
                    <p className="adm-faint">{relative(item.atUtc, now, language)}</p>
                  </div>
                  {item.userId ? (
                    <button type="button" className="adm-button" onClick={() => onOpenUser(item.userId!)}>
                      {u.openUser}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Health health={data.health} copy={copy} language={language} now={now} />
    </div>
  )
}

/** Cada tipo se redacta a su manera: `reference` y `detail` significan cosas distintas en cada uno. */
function titleFor(item: AdminUrgency, copy: AdminCopy): string {
  const u = copy.urgencies
  const template = u.kinds[item.kind] ?? item.kind
  switch (item.kind) {
    case 'webhook_rejected':
      return fill(template, { n: item.count })
    case 'trial_blocked':
      return fill(template, { n: item.count, reason: u.trialReasons[item.detail ?? ''] ?? item.detail ?? '' })
    case 'ai_failing':
      return fill(template, { n: item.count, metric: item.reference ?? '' })
    default:
      return template
  }
}

function detailFor(item: AdminUrgency, copy: AdminCopy, language: Language): string | null {
  const u = copy.urgencies
  switch (item.kind) {
    case 'orphan_payment':
      return fill(u.orphanDetail, { ref: item.reference ?? '—', topic: item.detail ?? '—' })
    case 'webhook_rejected':
      return fill(u.rejectedDetail, { reason: item.detail ?? '—' })
    case 'payment_pending':
      return fill(u.pendingDetail, { email: item.userEmail ?? '—', reason: item.detail ?? '—' })
    case 'payment_failed': {
      const base = fill(u.failedDetail, { email: item.userEmail ?? '—', reason: item.detail ?? '—' })
      return item.deadlineUtc ? `${base} · ${fill(u.graceLeft, { date: dateShort(item.deadlineUtc, language) })}` : base
    }
    case 'ai_failing':
      return u.aiErrors[item.detail ?? ''] ?? item.detail
    default:
      return null
  }
}

function Health({ health, copy, language, now }: { health: AdminPaymentsHealth; copy: AdminCopy; language: Language; now: number }) {
  const u = copy.urgencies
  const rows: [string, React.ReactNode][] = [
    [u.received, health.notificationsReceived],
    [u.accepted, health.notificationsAccepted],
    [u.rejected, health.notificationsRejected > 0 ? <span key="rejected" className="adm-pill is-bad">▲ {health.notificationsRejected}</span> : 0],
    [u.lastAccepted, health.lastAcceptedAtUtc ? relative(health.lastAcceptedAtUtc, now, language) : u.never],
    [u.reconcile, health.reconcileIntervalMinutes > 0 ? fill(u.reconcileEvery, { n: health.reconcileIntervalMinutes }) : u.reconcileOff],
    [u.secret, health.webhookSecretConfigured ? u.secretOk : <span key="secret" className="adm-pill is-bad">{u.secretMissing}</span>],
    [u.credentials, health.usingTestCredentials ? <span key="credentials" className="adm-pill is-warn">{u.credentialsTest}</span> : u.credentialsLive],
    [u.testPayer, health.testPayerEmail ? <span key="payer" className="adm-pill is-warn">{health.testPayerEmail}</span> : u.testPayerNone],
  ]

  return (
    <aside className="adm-card" aria-labelledby="adm-health">
      <header className="adm-card-head">
        <h3 id="adm-health">{u.health}</h3>
        <span className="adm-muted">{u.healthSince}</span>
      </header>
      <dl className="adm-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
