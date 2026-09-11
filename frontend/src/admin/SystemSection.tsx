import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import { getAdminSystem } from './adminApi'
import { dateTime, relative } from './format'
import { LoadError, RankList } from './parts'
import type { AdminIntegration } from './types'
import { useAdminLoad } from './useAdminLoad'

/** Cada estado con su forma, además del color. */
const STATE_STYLE: Record<string, { tone: string; glyph: string }> = {
  ok: { tone: 'ok', glyph: '●' },
  warn: { tone: 'warn', glyph: '◆' },
  bad: { tone: 'bad', glyph: '▲' },
  off: { tone: 'off', glyph: '○' },
}

/** Sistema: con qué está andando esta instancia, y quién hizo qué desde el panel. */
export function SystemSection({
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
  const s = copy.system
  const { data, error, loading, reload } = useAdminLoad('system', () => getAdminSystem(token))

  if (!data) {
    return error ? <LoadError copy={copy} message={error} onRetry={reload} /> : <p className="adm-muted">{copy.loading}</p>
  }

  const facts: [string, string][] = [
    [s.environment, data.environment],
    [s.version, data.version ?? s.unknownVersion],
    [s.started, `${relative(data.startedAtUtc, now, language)} · ${dateTime(data.startedAtUtc, language)}`],
  ]

  return (
    <div className={`adm-stack${loading ? ' is-refreshing' : ''}`}>
      <div className="adm-grid-charts">
        <section className="adm-card" aria-labelledby="adm-integrations">
          <header className="adm-card-head">
            <h3 id="adm-integrations">{s.integrationsTitle}</h3>
          </header>
          <ul className="adm-checks">
            {data.integrations.map((item) => (
              <Integration key={item.key} item={item} copy={copy} />
            ))}
          </ul>
        </section>

        <div className="adm-stack">
          <section className="adm-card" aria-labelledby="adm-instance">
            <header className="adm-card-head">
              <h3 id="adm-instance">{s.instanceTitle}</h3>
            </header>
            <dl className="adm-facts">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="adm-card" aria-labelledby="adm-denials">
            <header className="adm-card-head">
              <h3 id="adm-denials">{s.denialsTitle}</h3>
              <span className="adm-muted">{s.denialsSub}</span>
            </header>
            <RankList items={data.trialDenials30d} label={(key) => copy.urgencies.trialReasons[key] ?? key} empty={s.denialsEmpty} />
          </section>
        </div>
      </div>

      <section className="adm-card" aria-labelledby="adm-audit">
        <header className="adm-card-head">
          <h3 id="adm-audit">{s.auditTitle}</h3>
          <span className="adm-muted">{s.auditSub}</span>
        </header>
        {data.audit.length === 0 ? (
          <p className="adm-muted">{s.auditEmpty}</p>
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{s.colWhen}</th>
                  <th scope="col">{s.colAdmin}</th>
                  <th scope="col">{s.colAction}</th>
                  <th scope="col">{s.colTarget}</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{dateTime(entry.createdAtUtc, language)}</td>
                    <td>{entry.adminEmail}</td>
                    <td>
                      {s.actions[entry.action] ?? entry.action}
                      {entry.details ? <span className="adm-faint"> · {entry.details}</span> : null}
                    </td>
                    <td>
                      {entry.targetUserId ? (
                        <button type="button" className="adm-link" onClick={() => onOpenUser(entry.targetUserId!)}>
                          {s.openTarget}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
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

function Integration({ item, copy }: { item: AdminIntegration; copy: AdminCopy }) {
  const s = copy.system
  const style = STATE_STYLE[item.state] ?? STATE_STYLE.off
  const hint = s.hints[`${item.key}:${item.state}`]

  return (
    <li className="adm-check">
      <span className={`adm-pill is-${style.tone}`}>
        <span aria-hidden="true">{style.glyph}</span>
        {s.states[item.state] ?? item.state}
      </span>
      <div className="adm-check-body">
        <p className="adm-check-title">{s.integrations[item.key] ?? item.key}</p>
        {hint ? <p className="adm-muted">{hint}</p> : null}
        {item.value ? <code className="adm-code">{item.value}</code> : null}
      </div>
    </li>
  )
}
