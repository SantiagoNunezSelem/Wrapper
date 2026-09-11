import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminBusiness } from './adminApi'
import { ColumnChart } from './charts'
import { compact, count, dateShort, fill, money, monthLabel, percent, usd } from './format'
import { LoadError, PeriodChips, StatusPill, Tile } from './parts'
import type { AdminBusiness, AdminPeriod } from './types'
import { useAdminLoad } from './useAdminLoad'

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
  const [days, setDays] = useState<AdminPeriod>(30)
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
      <PeriodChips days={days} onChange={setDays} copy={copy} />

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
        <Tile label={b.conversion} value={data.trialConversion === null ? copy.noData : percent(data.trialConversion, language)}>
          {data.trialConversion === null ? (
            b.noConversion
          ) : conversionDelta === null ? null : (
            <span className={conversionDelta < 0 ? 'adm-down' : conversionDelta > 0 ? 'adm-up' : undefined}>
              {fill(b.conversionDelta, { sign: conversionDelta > 0 ? '+' : conversionDelta < 0 ? '−' : '', n: Math.abs(conversionDelta) })}
            </span>
          )}
        </Tile>
      </div>

      <UsageTiles data={data} copy={copy} language={language} />

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
                const when = ago === 0 ? copy.today : fill(copy.daysAgo, { n: ago })
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

      <div className="adm-grid-2">
        <Funnel data={data} copy={copy} language={language} />
        <ProMovements data={data} copy={copy} language={language} />
      </div>

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
    </div>
  )
}

/** Uso y costo. Lo que empezó a registrarse con esta versión dice eso en vez de mostrar un cero. */
function UsageTiles({ data, copy, language }: { data: AdminBusiness; copy: AdminCopy; language: Language }) {
  const b = copy.business
  const share = (n: number) => (data.registeredUsers > 0 ? fill(b.activeShare, { p: percent(n / data.registeredUsers, language) }) : null)
  const tokens = data.aiInputTokensMonth + data.aiOutputTokensMonth

  return (
    <div className="adm-grid-4">
      {data.activeUsers7 === null || data.activeUsers30 === null ? (
        <>
          <Tile label={b.activeUsers7} value={copy.noData} pending>{b.activeSince}</Tile>
          <Tile label={b.activeUsers30} value={copy.noData} pending>{b.activeSince}</Tile>
        </>
      ) : (
        <>
          <Tile label={b.activeUsers7} value={count(data.activeUsers7, language)}>{share(data.activeUsers7)}</Tile>
          <Tile label={b.activeUsers30} value={count(data.activeUsers30, language)}>{share(data.activeUsers30)}</Tile>
        </>
      )}
      {tokens === 0 ? (
        <Tile label={b.aiTokens} value={copy.noData} pending>{b.aiTokensNone}</Tile>
      ) : (
        <Tile label={b.aiTokens} value={compact(tokens, language)}>
          {fill(b.aiTokensSub, { in: compact(data.aiInputTokensMonth, language), out: compact(data.aiOutputTokensMonth, language) })}
        </Tile>
      )}
      {data.aiCostMonthUsd === null ? (
        <Tile label={b.aiCost} value={copy.aiPrices.missing} pending>{copy.aiPrices.missingHint}</Tile>
      ) : (
        <Tile label={b.aiCost} value={usd(data.aiCostMonthUsd, language)}>{b.aiCostSub}</Tile>
      )}
    </div>
  )
}

/** De las cuentas creadas en el período, cuántas llegaron a cada paso: dónde se cae la gente. */
function Funnel({ data, copy, language }: { data: AdminBusiness; copy: AdminCopy; language: Language }) {
  const b = copy.business
  const f = data.funnel
  const steps: [string, number][] = [
    [b.funnelSteps.registered, f.registered],
    [b.funnelSteps.savedAnalysis, f.savedAnalysis],
    [b.funnelSteps.openedCheckout, f.openedCheckout],
    [b.funnelSteps.paid, f.paid],
  ]

  return (
    <section className="adm-card" aria-labelledby="adm-funnel">
      <header className="adm-card-head">
        <h3 id="adm-funnel">{b.funnelTitle}</h3>
        <span className="adm-muted">{fill(b.funnelSub, { days: data.days })}</span>
      </header>
      {f.registered === 0 ? (
        <p className="adm-muted">{b.funnelEmpty}</p>
      ) : (
        <ol className="adm-funnel">
          {steps.map(([label, value]) => (
            <li key={label}>
              <span className="adm-funnel-label">{label}</span>
              <span className="adm-funnel-bar" aria-hidden="true">
                <span style={{ width: `${(value / f.registered) * 100}%` }} />
              </span>
              <span className="adm-funnel-value">
                {count(value, language)} · {percent(value / f.registered, language)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Altas y bajas de Pro por mes, el más reciente arriba. */
function ProMovements({ data, copy, language }: { data: AdminBusiness; copy: AdminCopy; language: Language }) {
  const b = copy.business
  const moved = data.proMovements.some((item) => item.started > 0 || item.cancelled > 0)

  return (
    <section className="adm-card" aria-labelledby="adm-movements">
      <header className="adm-card-head">
        <h3 id="adm-movements">{b.movementsTitle}</h3>
        <span className="adm-muted">{b.movementsSub}</span>
      </header>
      {!moved ? (
        <p className="adm-muted">{b.movementsEmpty}</p>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{b.colMonth}</th>
                <th scope="col" className="adm-num">{b.colStarted}</th>
                <th scope="col" className="adm-num">{b.colCancelled}</th>
                <th scope="col" className="adm-num">{b.colNet}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.proMovements].reverse().map((item) => {
                const net = item.started - item.cancelled
                return (
                  <tr key={item.month}>
                    <td>{monthLabel(item.month, language)}</td>
                    <td className="adm-num">{item.started}</td>
                    <td className="adm-num">{item.cancelled}</td>
                    <td className={`adm-num${net > 0 ? ' adm-up' : net < 0 ? ' adm-down' : ''}`}>
                      {net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
