import { useState, type FormEvent } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import {
  createAdminCampaign,
  deleteAdminCampaign,
  getAdminCampaignUsers,
  getAdminCampaigns,
  renameAdminCampaign,
  resetAdminCampaignVisits,
} from './adminApi'
import { count, dateShort, fill, money, percent, relative } from './format'
import { LoadError, Tile } from './parts'
import type { AdminCampaign } from './types'
import { useAdminLoad } from './useAdminLoad'

type SortKey = 'visits' | 'uniqueVisitors' | 'signups' | 'trials' | 'paid' | 'conversion' | 'revenue'

const conversion = (campaign: AdminCampaign) => (campaign.uniqueVisitors > 0 ? campaign.paid / campaign.uniqueVisitors : 0)

/** El link que va en el QR. El código no cambia nunca: renombrar la campaña no lo toca. */
export function campaignLink(code: string): string {
  return `${window.location.origin}/q/${code}`
}

/**
 * Campañas: un link por folleto (o por tanda), y qué hizo la gente que entró por cada uno —
 * visitas, registros, trial, pagos. El QR lo arma quien imprime, a partir del link.
 */
export function CampaignsSection({
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
  const c = copy.campaigns
  const { data, error, loading, reload } = useAdminLoad('campaigns', () => getAdminCampaigns(token))
  const [sort, setSort] = useState<SortKey>('paid')
  const [openId, setOpenId] = useState<string | null>(null)

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const totals = data.reduce(
    (sum, item) => ({
      visits: sum.visits + item.visits,
      signups: sum.signups + item.signups,
      paid: sum.paid + item.paid,
      revenue: sum.revenue + item.revenue,
    }),
    { visits: 0, signups: 0, paid: 0, revenue: 0 },
  )

  const value = (item: AdminCampaign, key: SortKey) => (key === 'conversion' ? conversion(item) : item[key])
  const sorted = [...data].sort((a, b) => value(b, sort) - value(a, sort) || b.signups - a.signups || b.visits - a.visits)
  const open = data.find((item) => item.id === openId) ?? null

  const columns: { key: SortKey; label: string; title?: string }[] = [
    { key: 'visits', label: c.colVisits },
    { key: 'uniqueVisitors', label: c.colUnique },
    { key: 'signups', label: c.colSignups },
    { key: 'trials', label: c.colTrials },
    { key: 'paid', label: c.colPaid },
    { key: 'conversion', label: c.colConversion, title: c.conversionHint },
    { key: 'revenue', label: c.colRevenue },
  ]

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <p className="adm-muted adm-campaign-intro">{c.intro}</p>

      <CreateCampaign
        token={token}
        copy={copy}
        onCreated={(id) => {
          setOpenId(id)
          reload()
        }}
      />

      <div className="adm-grid-4">
        <Tile label={c.totalVisits} value={count(totals.visits, language)}>{c.totalVisitsSub}</Tile>
        <Tile label={c.totalSignups} value={count(totals.signups, language)}>{c.totalSignupsSub}</Tile>
        <Tile label={c.totalPaid} value={count(totals.paid, language)}>{c.totalPaidSub}</Tile>
        <Tile label={c.totalRevenue} value={money(totals.revenue, 'ARS', language)}>{c.totalRevenueSub}</Tile>
      </div>

      <section className="adm-card" aria-label={copy.nav.campanas}>
        {data.length === 0 ? (
          <p className="adm-muted">{c.empty}</p>
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{c.colTitle}</th>
                  {columns.map((column) => (
                    <th key={column.key} scope="col" className="adm-num" aria-sort={sort === column.key ? 'descending' : 'none'}>
                      <button
                        type="button"
                        className={`adm-sort${sort === column.key ? ' is-on' : ''}`}
                        title={column.title ?? fill(c.sortBy, { col: column.label })}
                        onClick={() => setSort(column.key)}
                      >
                        {column.label}
                        {sort === column.key ? <span aria-hidden="true"> ↓</span> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id} className={item.id === openId ? 'is-selected' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="adm-link"
                        aria-expanded={item.id === openId}
                        onClick={() => setOpenId(item.id === openId ? null : item.id)}
                      >
                        {item.title}
                      </button>
                      <span className="adm-faint"> · /q/{item.code}</span>
                    </td>
                    <td className="adm-num">{count(item.visits, language)}</td>
                    <td className="adm-num">{count(item.uniqueVisitors, language)}</td>
                    <td className="adm-num">{count(item.signups, language)}</td>
                    <td className="adm-num">{count(item.trials, language)}</td>
                    <td className="adm-num">{count(item.paid, language)}</td>
                    <td className="adm-num">{item.uniqueVisitors > 0 ? percent(conversion(item), language) : '—'}</td>
                    <td className="adm-num">{money(item.revenue, 'ARS', language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open ? (
        <CampaignDetail
          key={open.id}
          token={token}
          language={language}
          copy={copy}
          campaign={open}
          onOpenUser={onOpenUser}
          onChanged={reload}
          onDeleted={() => {
            setOpenId(null)
            reload()
          }}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  )
}

function CreateCampaign({ token, copy, onCreated }: { token: string; copy: AdminCopy; onCreated: (id: string) => void }) {
  const c = copy.campaigns
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      const created = await createAdminCampaign(token, title.trim())
      setTitle('')
      onCreated(created.id)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="adm-card adm-campaign-create" onSubmit={submit}>
      <label className="adm-campaign-field">
        <span className="adm-tile-label">{c.createTitle}</span>
        <input
          className="adm-input"
          value={title}
          maxLength={120}
          placeholder={c.titlePlaceholder}
          aria-label={c.titleLabel}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <button type="submit" className="adm-button is-primary" disabled={busy || !title.trim()}>
        {busy ? c.creating : c.create}
      </button>
      {failed ? (
        <span className="adm-error-text" role="alert">
          {c.createFailed}
        </span>
      ) : null}
    </form>
  )
}

type Pending = 'reset' | 'delete' | null

function CampaignDetail({
  token,
  language,
  copy,
  campaign,
  onOpenUser,
  onChanged,
  onDeleted,
  onClose,
}: {
  token: string
  language: Language
  copy: AdminCopy
  campaign: AdminCampaign
  onOpenUser: (id: string) => void
  onChanged: () => void
  onDeleted: () => void
  onClose: () => void
}) {
  const c = copy.campaigns
  const link = campaignLink(campaign.code)
  const users = useAdminLoad(`campaign-users:${campaign.id}:${campaign.signups}`, () => getAdminCampaignUsers(token, campaign.id))
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(campaign.title)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied(null), 2000)
  }

  async function run(action: () => Promise<unknown>, after: () => void) {
    setBusy(true)
    setFailed(false)
    try {
      await action()
      after()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    void run(
      () => renameAdminCampaign(token, campaign.id, title.trim()),
      () => {
        setEditing(false)
        onChanged()
      },
    )
  }

  const confirm = () => {
    if (pending === 'reset') {
      void run(
        () => resetAdminCampaignVisits(token, campaign.id),
        () => {
          setPending(null)
          onChanged()
        },
      )
    } else if (pending === 'delete') {
      void run(() => deleteAdminCampaign(token, campaign.id), onDeleted)
    }
  }

  const meta = [
    fill(c.createdOn, { date: dateShort(campaign.createdAtUtc, language) }),
    campaign.lastVisitAtUtc ? fill(c.lastVisit, { when: relative(campaign.lastVisitAtUtc, Date.now(), language) }) : c.noVisits,
    campaign.visitsResetAtUtc ? fill(c.resetOn, { date: dateShort(campaign.visitsResetAtUtc, language) }) : null,
  ].filter(Boolean)

  return (
    <section className="adm-card" aria-labelledby="adm-campaign-title">
      <header className="adm-card-head">
        {editing ? (
          <form className="adm-campaign-rename" onSubmit={save}>
            <input
              className="adm-input"
              value={title}
              maxLength={120}
              aria-label={c.titleLabel}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" className="adm-button is-primary" disabled={busy || !title.trim()}>
              {busy ? c.saving : c.save}
            </button>
            <button
              type="button"
              className="adm-button"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setTitle(campaign.title)
              }}
            >
              {c.cancel}
            </button>
          </form>
        ) : (
          <h3 id="adm-campaign-title">{campaign.title}</h3>
        )}
        <button type="button" className="adm-link" onClick={onClose}>
          {c.hideDetails}
        </button>
      </header>

      <div className="adm-campaign-link">
        <code className="adm-code">{link}</code>
        <button type="button" className="adm-button" onClick={copyLink}>
          {copied === 'ok' ? c.copied : copied === 'failed' ? c.copyFailed : c.copy}
        </button>
      </div>
      <p className="adm-faint">{meta.join(' · ')}</p>

      {pending ? (
        <div className="adm-confirm" role="alertdialog" aria-label={pending === 'reset' ? c.resetVisits : c.delete}>
          <p>
            {pending === 'reset'
              ? fill(c.resetConfirm, { n: count(campaign.visits, language), title: campaign.title })
              : fill(c.deleteConfirm, { n: count(campaign.signups, language), title: campaign.title })}
          </p>
          <div className="adm-actions">
            <button type="button" className="adm-button is-danger" disabled={busy} onClick={confirm}>
              {busy ? c.working : c.confirm}
            </button>
            <button type="button" className="adm-button" disabled={busy} onClick={() => setPending(null)}>
              {c.back}
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-actions">
          {!editing ? (
            <button type="button" className="adm-button" onClick={() => setEditing(true)}>
              {c.rename}
            </button>
          ) : null}
          <button type="button" className="adm-button" disabled={campaign.visits === 0} onClick={() => setPending('reset')}>
            {c.resetVisits}
          </button>
          <button type="button" className="adm-button is-danger" onClick={() => setPending('delete')}>
            {c.delete}
          </button>
        </div>
      )}
      {failed ? (
        <p className="adm-error-text" role="alert">
          {c.actionFailed}
        </p>
      ) : null}

      <h4 className="adm-eyebrow adm-campaign-users-title">{c.usersTitle}</h4>
      {!users.data ? (
        users.error ? (
          <LoadError copy={copy} message={users.error} onRetry={users.reload} />
        ) : (
          <p className="adm-muted">{copy.loading}</p>
        )
      ) : users.data.length === 0 ? (
        <p className="adm-muted">{c.usersEmpty}</p>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{c.colUser}</th>
                <th scope="col">{c.colJoined}</th>
                <th scope="col">{c.colState}</th>
                <th scope="col" className="adm-num">{c.colRevenue}</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id}>
                  <td>
                    <button type="button" className="adm-link" onClick={() => onOpenUser(user.id)}>
                      {user.email}
                    </button>
                  </td>
                  <td>{dateShort(user.createdAtUtc, language)}</td>
                  <td>
                    {user.paid ? (
                      <span className="adm-pill is-ok">
                        <span aria-hidden="true">●</span>
                        {c.statePaid}
                      </span>
                    ) : user.trial ? (
                      <span className="adm-pill is-warn">
                        <span aria-hidden="true">◆</span>
                        {c.stateTrial}
                      </span>
                    ) : (
                      <span className="adm-pill">{c.stateRegistered}</span>
                    )}
                  </td>
                  <td className="adm-num">{money(user.revenue, 'ARS', language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
