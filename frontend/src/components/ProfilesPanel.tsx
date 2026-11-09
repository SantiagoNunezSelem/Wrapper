import { personalityEmoji } from '../lib/personality'
import type { ParticipantProfile } from '../types'
import { ChartRenderer } from './charts/ChartRenderer'

export interface ProfilesCopy {
  /** Contains `{count}`, replaced with how many messages the reading is based on. */
  basedOn: string
  /** Badge on a profile the AI wrote. */
  aiBadge: string
  /** Badge on a profile the browser's own reading wrote — only ever the fallback. */
  localBadge: string
  /** Before the second label: "También: Intenso". */
  also: string
}

/**
 * One card per person: who they are, the personality, why, and the shape of how they write.
 * Shared by the desktop modal, the mobile sheet and the public shared story, so a shared
 * link shows exactly what its owner saw.
 */
export function ProfilesPanel({ profiles, copy }: { profiles: ParticipantProfile[]; copy: ProfilesCopy }) {
  return (
    <div className="profile-list">
      {profiles.map((profile) => (
        <article className="profile-card" key={profile.name}>
          <header className="profile-head">
            <span
              className="profile-dot"
              style={profile.color ? { background: profile.color } : undefined}
              aria-hidden="true"
            />
            <h4 className="profile-name">{profile.name}</h4>
            <span className={`profile-source is-${profile.source}`}>
              {profile.source === 'ai' ? copy.aiBadge : copy.localBadge}
            </span>
          </header>

          <div className="profile-labels">
            <strong className="profile-label">
              <span aria-hidden="true">{personalityEmoji(profile.labelId)} </span>
              {profile.label}
            </strong>
            {profile.secondaryLabel ? (
              <span className="profile-label-secondary">
                {copy.also}: {profile.secondaryLabel}
              </span>
            ) : null}
          </div>

          <p className="profile-summary">{profile.summary}</p>

          <div className="profile-radar">
            <ChartRenderer chart={{ kind: 'radar', axes: profile.radar }} compact />
          </div>

          <p className="profile-foot">
            {copy.basedOn.replace('{count}', profile.messageCount.toLocaleString())}
          </p>
        </article>
      ))}
    </div>
  )
}
