import { useState } from 'react'
import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminProduct } from './adminApi'
import { ColumnChart } from './charts'
import { count, fill } from './format'
import { LoadError, PeriodChips, RankList, Tile } from './parts'
import type { AdminPeriod } from './types'
import { useAdminLoad } from './useAdminLoad'

/** Producto: qué usa la gente de Vistazo y qué comparte. */
export function ProductSection({ token, language, copy }: { token: string; language: Language; copy: AdminCopy }) {
  const p = copy.product
  const [days, setDays] = useState<AdminPeriod>(30)
  const { data, error, loading, reload } = useAdminLoad(`product:${days}`, () => getAdminProduct(token, days))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const analyses = data.analysesByDay.reduce((sum, value) => sum + value, 0)
  const inPeriod = fill(p.inPeriod, { days: data.days })
  const metric = (key: string) => <code className="adm-code">{key}</code>

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <PeriodChips days={days} onChange={setDays} copy={copy} />

      <div className="adm-grid-3">
        <Tile label={p.analyses} value={count(analyses, language)}>{inPeriod}</Tile>
        <Tile label={p.shared} value={count(data.sharedInPeriod, language)}>{inPeriod}</Tile>
        <Tile label={p.live} value={count(data.liveShares, language)}>{fill(p.liveSub, { n: count(data.liveShareViews, language) })}</Tile>
      </div>

      <section className="adm-card" aria-labelledby="adm-analyses">
        <header className="adm-card-head">
          <h3 id="adm-analyses">{p.analysesTitle}</h3>
          <span className="adm-muted">{inPeriod}</span>
        </header>
        {analyses > 0 ? (
          <ColumnChart
            ariaLabel={p.analysesTitle}
            color="var(--vz-brand-cyan)"
            formatTick={(value) => count(value, language)}
            data={data.analysesByDay.map((value, index) => {
              const ago = data.analysesByDay.length - 1 - index
              const when = ago === 0 ? copy.today : fill(copy.daysAgo, { n: ago })
              return { value, label: when, tip: fill(p.analysesTip, { n: value, when }) }
            })}
          />
        ) : (
          <p className="adm-muted">{p.analysesEmpty}</p>
        )}
      </section>

      <div className="adm-grid-2">
        <section className="adm-card" aria-labelledby="adm-unlocked">
          <header className="adm-card-head">
            <h3 id="adm-unlocked">{p.unlockedTitle}</h3>
          </header>
          <RankList items={data.topUnlocked} label={metric} empty={p.listEmpty} />
        </section>
        <section className="adm-card" aria-labelledby="adm-top-ai">
          <header className="adm-card-head">
            <h3 id="adm-top-ai">{p.aiTitle}</h3>
          </header>
          <RankList items={data.topAiMetrics} label={metric} empty={p.listEmpty} />
        </section>
      </div>
    </div>
  )
}
