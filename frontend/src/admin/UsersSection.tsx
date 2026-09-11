import { useEffect, useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { addAdminNote, getAdminUser, searchAdminUsers, syncAdminUser } from './adminApi'
import { compact, count, dateShort, dateTime, describeEvent, fill, money, paymentMethod, relative } from './format'
import { ExportButton, LoadError, StatusPill } from './parts'
import type { AdminNote, AdminSubscription, AdminUserDetail } from './types'
import { useAdminLoad } from './useAdminLoad'

/** Usuarios: buscar una cuenta y verla entera. El soporte de "pagué y no tengo acceso". */
export function UsersSection({
  token,
  language,
  copy,
  userId,
  onSelectUser,
  now = Date.now(),
}: {
  token: string
  language: Language
  copy: AdminCopy
  userId: string | null
  onSelectUser: (id: string) => void
  now?: number
}) {
  const s = copy.users
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)

  // Espera a que se deje de tipear: una búsqueda por tecla es una consulta por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTerm(query.trim())
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const list = useAdminLoad(`users:${term}:${page}`, () => searchAdminUsers(token, term, page))
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <div className="adm-grid-users">
      <section className="adm-card adm-results" aria-label={s.searchLabel}>
        <label className="adm-search">
          <span className="adm-sr">{s.searchLabel}</span>
          <input type="search" value={query} placeholder={s.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
        </label>

        {list.data ? (
          <>
            <div className="adm-row">
              <p className="adm-faint">{fill(s.results, { n: count(list.data.total, language) })}</p>
              <ExportButton token={token} kind="users" copy={copy} />
            </div>
            {list.data.items.length === 0 ? (
              <p className="adm-muted">{s.noResults}</p>
            ) : (
              <ul className="adm-result-list">
                {list.data.items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`adm-result${row.id === userId ? ' is-on' : ''}`}
                      aria-current={row.id === userId ? 'true' : undefined}
                      onClick={() => onSelectUser(row.id)}
                    >
                      <span className="adm-result-name">{row.displayName || row.email}</span>
                      <span className="adm-faint">{row.email}</span>
                      <StatusPill status={row.state} copy={copy} />
                    </button>
                  </li>
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
          </>
        ) : list.error ? (
          <LoadError copy={copy} message={list.error} onRetry={list.reload} />
        ) : (
          <p className="adm-muted">{copy.loading}</p>
        )}
      </section>

      {userId ? (
        <UserDetailPanel key={userId} token={token} language={language} copy={copy} userId={userId} now={now} />
      ) : (
        <p className="adm-card adm-empty">{s.pick}</p>
      )}
    </div>
  )
}

function UserDetailPanel({
  token,
  language,
  copy,
  userId,
  now,
}: {
  token: string
  language: Language
  copy: AdminCopy
  userId: string
  now: number
}) {
  const s = copy.users
  const detail = useAdminLoad(`user:${userId}`, () => getAdminUser(token, userId))
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [showTech, setShowTech] = useState(false)

  if (!detail.data) {
    return detail.error ? <LoadError copy={copy} message={detail.error} onRetry={detail.reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const d: AdminUserDetail = detail.data

  async function sync() {
    setSyncing(true)
    setSyncError(null)
    try {
      detail.replace(await syncAdminUser(token, userId))
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="adm-stack">
      <section className="adm-card adm-who">
        <div>
          <h2>{d.displayName || d.email}</h2>
          <p className="adm-muted">
            {d.email} · {fill(s.joined, { date: dateShort(d.createdAtUtc, language) })}
          </p>
          <p className="adm-faint">{d.lastSeenAtUtc ? fill(s.lastSeen, { when: relative(d.lastSeenAtUtc, now, language) }) : s.lastSeenNever}</p>
        </div>
        <div className="adm-badges">
          <StatusPill status={d.state} copy={copy} />
          {d.isAdmin ? <span className="adm-pill">{s.admin}</span> : null}
          {d.hasUsedTrial ? <span className="adm-pill">{s.usedTrial}</span> : null}
          {d.aiConsentAtUtc ? <span className="adm-pill">{s.aiConsent}</span> : null}
        </div>
      </section>

      <div className="adm-grid-2">
        <section className="adm-card" aria-labelledby="adm-sub">
          <header className="adm-card-head">
            <h3 id="adm-sub">{s.subscription}</h3>
            <span className="adm-faint">
              {d.current?.lastSyncedAtUtc ? fill(s.synced, { when: relative(d.current.lastSyncedAtUtc, now, language) }) : s.neverSynced}
            </span>
          </header>
          {d.current ? <SubscriptionFacts subscription={d.current} copy={copy} language={language} /> : <p className="adm-muted">{s.noSubscription}</p>}
          <div className="adm-actions">
            <button type="button" className="adm-button is-primary" disabled={syncing} onClick={sync}>
              {syncing ? s.syncing : s.sync}
            </button>
          </div>
          {syncError ? <p className="adm-error-text" role="alert">{syncError}</p> : null}
          {d.subscriptions.length > 1 ? (
            <>
              <h4 className="adm-eyebrow">{s.history}</h4>
              <ul className="adm-plain">
                {d.subscriptions.map((item) => (
                  <li key={item.id}>
                    <StatusPill status={item.status} copy={copy} />{' '}
                    <span className="adm-faint">
                      {item.planType} · {money(item.amount, item.currencyId, language)} · {dateShort(item.createdAtUtc, language)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="adm-card" aria-labelledby="adm-activity">
          <header className="adm-card-head">
            <h3 id="adm-activity">{s.activity}</h3>
            {d.events.length > 0 ? (
              <button type="button" className="adm-button" aria-expanded={showTech} onClick={() => setShowTech((value) => !value)}>
                {showTech ? s.hideTech : s.showTech}
              </button>
            ) : null}
          </header>
          {d.events.length === 0 ? (
            <p className="adm-muted">{s.noActivity}</p>
          ) : (
            <ol className="adm-timeline">
              {d.events.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.createdAtUtc}>{dateTime(event.createdAtUtc, language)}</time>
                  <span>
                    {describeEvent(event, copy)}
                    {event.resultingStatus ? <span className="adm-faint"> · {copy.statuses[event.resultingStatus] ?? event.resultingStatus}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {showTech ? (
            <ul className="adm-raw">
              {d.events.map((event) => (
                <li key={event.id}>{[event.topic, event.action, event.notes, event.resultingStatus].filter(Boolean).join(' · ')}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <div className="adm-grid-2">
        <section className="adm-card" aria-labelledby="adm-invoices">
          <header className="adm-card-head">
            <h3 id="adm-invoices">{s.invoices}</h3>
          </header>
          {d.invoices.length === 0 ? (
            <p className="adm-muted">{s.noInvoices}</p>
          ) : (
            <div className="adm-table-scroll">
              <table className="adm-table">
                <tbody>
                  {d.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{dateShort(invoice.paidAtUtc ?? invoice.debitScheduledAtUtc ?? invoice.createdAtUtc, language)}</td>
                      <td>{invoice.status}{invoice.statusDetail ? <span className="adm-faint"> · {invoice.statusDetail}</span> : null}</td>
                      <td className="adm-num">{money(invoice.amount, invoice.currencyId, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="adm-card" aria-labelledby="adm-usage">
          <header className="adm-card-head">
            <h3 id="adm-usage">{s.usage}</h3>
          </header>
          <dl className="adm-facts">
            <div><dt>{s.savedAnalyses}</dt><dd>{d.usage.savedAnalyses}</dd></div>
            <div><dt>{s.sharedStories}</dt><dd>{d.usage.sharedStories}</dd></div>
            <div>
              <dt>{s.aiMetrics}</dt>
              <dd>
                {d.usage.aiMetrics}
                {d.usage.aiMetricsFailed > 0 ? <span className="adm-faint"> · {fill(s.aiFailed, { n: d.usage.aiMetricsFailed })}</span> : null}
              </dd>
            </div>
            <div><dt>{s.aiTokens}</dt><dd>{compact(d.usage.aiTokens, language)}</dd></div>
            <div><dt>{s.freeUnlocks}</dt><dd>{d.usage.freeUnlocks}</dd></div>
            <div>
              <dt>{s.trialClaims}</dt>
              <dd>
                {d.usage.trialClaims}
                {d.usage.trialCountries.length > 0 ? <span className="adm-faint"> · {d.usage.trialCountries.join(', ')}</span> : null}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <NotesCard
        token={token}
        userId={userId}
        notes={d.notes}
        copy={copy}
        language={language}
        now={now}
        onAdded={(note) => detail.update((current) => ({ ...current, notes: [note, ...current.notes] }))}
      />
    </div>
  )
}

/** Lo que el soporte sabe de la cuenta y no está en ningún otro lado. Se agrega, no se edita. */
function NotesCard({
  token,
  userId,
  notes,
  copy,
  language,
  now,
  onAdded,
}: {
  token: string
  userId: string
  notes: AdminNote[]
  copy: AdminCopy
  language: Language
  now: number
  onAdded: (note: AdminNote) => void
}) {
  const s = copy.users
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = text.trim()
    if (!clean) {
      return
    }

    setSaving(true)
    setError(null)
    try {
      onAdded(await addAdminNote(token, userId, clean))
      setText('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="adm-card" aria-labelledby="adm-notes">
      <header className="adm-card-head">
        <h3 id="adm-notes">{s.notes}</h3>
        <span className="adm-faint">{s.notesHint}</span>
      </header>
      {notes.length === 0 ? (
        <p className="adm-muted adm-notes-empty">{s.noNotes}</p>
      ) : (
        <ul className="adm-notes">
          {notes.map((note) => (
            <li key={note.id}>
              <p className="adm-note-text">{note.text}</p>
              <p className="adm-faint">{fill(s.noteBy, { author: note.authorEmail, when: relative(note.createdAtUtc, now, language) })}</p>
            </li>
          ))}
        </ul>
      )}
      <form className="adm-note-form" onSubmit={submit}>
        <label>
          <span className="adm-sr">{s.noteLabel}</span>
          <textarea value={text} maxLength={2000} rows={2} placeholder={s.notePlaceholder} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit" className="adm-button" disabled={saving || !text.trim()}>
          {saving ? s.savingNote : s.addNote}
        </button>
      </form>
      {error ? <p className="adm-error-text" role="alert">{error}</p> : null}
    </section>
  )
}

function SubscriptionFacts({ subscription, copy, language }: { subscription: AdminSubscription; copy: AdminCopy; language: Language }) {
  const s = copy.users
  const rows: [string, React.ReactNode][] = [
    [s.status, <StatusPill key="status" status={subscription.status} copy={copy} />],
    [s.plan, `${subscription.planType} · ${money(subscription.amount, subscription.currencyId, language)}`],
  ]

  if (subscription.graceEndsAtUtc && subscription.status === 'pago_fallido') {
    rows.push([s.graceUntil, dateShort(subscription.graceEndsAtUtc, language)])
  } else if (subscription.status === 'trial' && subscription.trialEndsAtUtc) {
    rows.push([s.trialUntil, dateShort(subscription.trialEndsAtUtc, language)])
  } else if (subscription.nextBillingAtUtc) {
    rows.push([s.nextBilling, dateShort(subscription.nextBillingAtUtc, language)])
  }

  const method = paymentMethod(subscription.paymentMethodLabel, copy)
  if (method) rows.push([s.method, method])
  if (subscription.externalSubscriptionId) rows.push([s.reference, <code key="ref" className="adm-code">{subscription.externalSubscriptionId}</code>])
  if (subscription.lastPaymentStatusDetail) rows.push([s.lastDetail, <code key="detail" className="adm-code">{subscription.lastPaymentStatusDetail}</code>])

  return (
    <dl className="adm-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
