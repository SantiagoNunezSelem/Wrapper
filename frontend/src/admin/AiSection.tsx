import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminAi } from './adminApi'
import { ColumnChart } from './charts'
import { compact, count, fill, usd } from './format'
import { LoadError, PeriodChips, RankList, Tile } from './parts'
import type { AdminPeriod } from './types'
import { useAdminLoad } from './useAdminLoad'

/** IA: cuánto se le pide a Gemini, cuánto cuesta y qué falla. */
export function AiSection({ token, language, copy }: { token: string; language: Language; copy: AdminCopy }) {
  const a = copy.ai
  const [days, setDays] = useState<AdminPeriod>(30)
  const { data, error, loading, reload } = useAdminLoad(`ai:${days}`, () => getAdminAi(token, days))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const hasTokens = data.tokensByDay.some((value) => value > 0)

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <PeriodChips days={days} onChange={setDays} copy={copy} />

      {data.tracked ? null : <p className="adm-card adm-empty">{a.notTracked}</p>}

      <div className="adm-grid-4">
        <Tile label={a.input} value={compact(data.inputTokens, language)}>{a.inputSub}</Tile>
        <Tile label={a.output} value={compact(data.outputTokens, language)}>{a.outputSub}</Tile>
        {data.costUsd === null ? (
          <Tile label={a.cost} value={copy.aiPrices.missing} pending>{copy.aiPrices.missingHint}</Tile>
        ) : (
          <Tile label={a.cost} value={usd(data.costUsd, language)}>{fill(a.costSub, { days: data.days })}</Tile>
        )}
        <Tile label={a.model} value={data.model || '—'} />
      </div>

      <div className="adm-grid-charts">
        <section className="adm-card" aria-labelledby="adm-ai-tokens">
          <header className="adm-card-head">
            <h3 id="adm-ai-tokens">{a.tokensTitle}</h3>
            <span className="adm-muted">{a.tokensSub}</span>
          </header>
          {hasTokens ? (
            <ColumnChart
              ariaLabel={a.tokensTitle}
              color="var(--vz-brand-violet)"
              formatTick={(value) => compact(value, language)}
              data={data.tokensByDay.map((value, index) => {
                const ago = data.tokensByDay.length - 1 - index
                const when = ago === 0 ? copy.today : fill(copy.daysAgo, { n: ago })
                return { value, label: when, tip: fill(a.tokensTip, { n: count(value, language), when }) }
              })}
            />
          ) : (
            <p className="adm-muted">{a.tokensEmpty}</p>
          )}
        </section>

        <section className="adm-card" aria-labelledby="adm-ai-errors">
          <header className="adm-card-head">
            <h3 id="adm-ai-errors">{a.errorsTitle}</h3>
            <span className="adm-muted">{a.errorsSub}</span>
          </header>
          <RankList items={data.errorsByCode} label={(key) => copy.urgencies.aiErrors[key] ?? key} empty={a.errorsEmpty} />
        </section>
      </div>

      <section className="adm-card" aria-labelledby="adm-ai-metrics">
        <header className="adm-card-head">
          <h3 id="adm-ai-metrics">{a.byMetricTitle}</h3>
        </header>
        {data.byMetric.length === 0 ? (
          <p className="adm-muted">{a.byMetricEmpty}</p>
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{a.colMetric}</th>
                  <th scope="col" className="adm-num">{a.colCalls}</th>
                  <th scope="col" className="adm-num">{a.colFailed}</th>
                  <th scope="col" className="adm-num">{a.colTokens}</th>
                </tr>
              </thead>
              <tbody>
                {data.byMetric.map((item) => (
                  <tr key={item.metricId}>
                    <td><code className="adm-code">{item.metricId}</code></td>
                    <td className="adm-num">{count(item.calls, language)}</td>
                    <td className="adm-num">
                      {item.failedCalls > 0 ? <span className="adm-down">{count(item.failedCalls, language)}</span> : 0}
                    </td>
                    <td className="adm-num">{compact(item.inputTokens + item.outputTokens, language)}</td>
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
