import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminBusiness } from './adminApi'
import { ColumnChart } from './charts'
import { count, dateShort, fill, money, monthLabel, percent } from './format'
import { useAdminLoad } from './useAdminLoad'
import { LoadError, StatusPill } from './parts'

const PERIODS = [7, 30, 90] as const

/** Negocio: cómo va Vistazo en números. Lo que todavía no se registra se muestra como tal. */
export function BusinessSection({
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
  const b = copy.business
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const { data, error, loading, reload } = useAdminLoad(`business:${days}`, () => getAdminBusiness(token, days))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const conversionDelta =
    data.trialConversion !== null && data.trialConversionPrevious !== null
      ? Math.round((data.trialConversion - data.trialConversionPrevious) * 100)
      : null

  // Un gráfico entero en cero no informa nada y encima inventa un eje ("$ 1"): se dice en palabras.
  const hasSignups = data.signupsByDay.some((value) => value > 0)
  const hasCollected = data.collectedByMonth.some((item) => item.amount > 0)
  const signupsTrend = data.newUsers > data.newUsersPrevious ? 'adm-up' : data.newUsers < data.newUsersPrevious ? 'adm-down' : undefined

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <div className="adm-chips" role="group" aria-label={b.periods[days]}>
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            className={`adm-chip${period === days ? ' is-on' : ''}`}
            aria-pressed={period === days}
            onClick={() => setDays(period)}
          >
            {b.periods[period]}
          </button>
        ))}
      </div>

      <div className="adm-grid-4">
        <Tile label={b.registered} value={count(data.registeredUsers, language)}>
          <span className={signupsTrend}>
            {fill(b.registeredDelta, { n: count(data.newUsers, language), prev: count(data.newUsersPrevious, language), days: data.days })}
          </span>
        </Tile>
        <Tile label={b.pro} value={count(data.proActive, language)}>
          {fill(b.proDelta, { n: data.newPro, trial: data.inTrial })}
        </Tile>
        <Tile label={b.mrr} value={money(data.monthlyRecurringRevenue, 'ARS', language)}>
          {fill(b.mrrHint, { n: data.proActive })}
        </Tile>
        <Tile label={b.conversion} value={data.trialConversion === null ? b.noData : percent(data.trialConversion, language)}>
          {data.trialConversion === null ? (
            b.noConversion
          ) : conversionDelta === null ? null : (
            <span className={conversionDelta < 0 ? 'adm-down' : conversionDelta > 0 ? 'adm-up' : undefined}>
              {fill(b.conversionDelta, { sign: conversionDelta > 0 ? '+' : conversionDelta < 0 ? '−' : '', n: Math.abs(conversionDelta) })}
            </span>
          )}
        </Tile>
      </div>

      <div className="adm-grid-charts">
        <section className="adm-card" aria-labelledby="adm-signups">
          <header className="adm-card-head">
            <h3 id="adm-signups">{b.signupsTitle}</h3>
            <span className="adm-muted">{fill(b.signupsSub, { n: data.newUsers, days: data.days })}</span>
          </header>
          {hasSignups ? (
            <ColumnChart
              ariaLabel={`${b.signupsTitle}: ${fill(b.signupsSub, { n: data.newUsers, days: data.days })}`}
              color="var(--vz-brand-violet)"
              formatTick={(value) => count(value, language)}
              data={data.signupsByDay.map((value, index) => {
                const ago = data.signupsByDay.length - 1 - index
                const when = ago === 0 ? b.today : fill(b.daysAgo, { n: ago })
                return { value, label: when, tip: fill(b.signupsTip, { n: value, when }) }
              })}
            />
          ) : (
            <p className="adm-muted">{b.signupsEmpty}</p>
          )}
        </section>

        <section className="adm-card" aria-labelledby="adm-collected">
          <header className="adm-card-head">
            <h3 id="adm-collected">{b.collectedTitle}</h3>
            <span className="adm-muted">{b.collectedSub}</span>
          </header>
          {hasCollected ? (
            <ColumnChart
              ariaLabel={b.collectedTitle}
              color="var(--vz-brand-cyan)"
              labels="all"
              formatTick={(value) => money(value, 'ARS', language)}
              data={data.collectedByMonth.map((item) => ({
                value: item.amount,
                label: monthLabel(item.month, language),
                tip: `${monthLabel(item.month, language)} · ${money(item.amount, 'ARS', language)}`,
              }))}
            />
          ) : (
            <p className="adm-muted">{b.collectedEmpty}</p>
          )}
        </section>
      </div>

      <div className="adm-grid-charts">
        <section className="adm-card" aria-labelledby="adm-latest">
          <header className="adm-card-head">
            <h3 id="adm-latest">{b.latestTitle}</h3>
          </header>
          {data.latestSubscriptions.length === 0 ? (
            <p className="adm-muted">{b.latestEmpty}</p>
          ) : (
            <div className="adm-table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">{b.colUser}</th>
                    <th scope="col">{b.colStatus}</th>
                    <th scope="col" className="adm-num">{b.colAmount}</th>
                    <th scope="col" className="adm-num">{b.colDate}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latestSubscriptions.map((item) => (
                    <tr key={`${item.userId}-${item.createdAtUtc}`}>
                      <td>
                        <button type="button" className="adm-link" onClick={() => onOpenUser(item.userId)}>
                          {item.email}
                        </button>
                      </td>
                      <td><StatusPill status={item.status} copy={copy} /></td>
                      <td className="adm-num">{money(item.amount, item.currencyId, language)}</td>
                      <td className="adm-num">{dateShort(item.createdAtUtc, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="adm-stack" aria-labelledby="adm-missing">
          <h3 id="adm-missing" className="adm-eyebrow">{b.missingTitle}</h3>
          <Tile label={b.activeUsers} value={b.noData} pending>{b.activeUsersWhy}</Tile>
          <Tile label={b.aiSpend} value={b.noData} pending>{b.aiSpendWhy}</Tile>
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, pending, children }: { label: string; value: string; pending?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`adm-card adm-tile${pending ? ' is-pending' : ''}`}>
      <span className="adm-tile-label">{label}</span>
      <span className="adm-tile-value">{value}</span>
      {children ? <span className="adm-tile-sub">{children}</span> : null}
    </div>
  )
}
