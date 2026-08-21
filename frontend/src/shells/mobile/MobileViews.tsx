import type { ShellCopy } from '../../copy/shellCopy'
import { formatMoney } from '../../lib/format'
import { formatNumber } from '../../lib/metrics'
import type { Language, SavedAnalysis, SubscriptionOverview, UserProfile } from '../../types'
import { ChatIcon, ChevronIcon, CrownIcon, UploadIcon } from './icons'

/* Las cuatro vistas de las pestañas. Son composición pura: cualquier dato o
   acción llega por props desde `MobileShell`, que a su vez lo saca de
   `useVistazo()`. Ninguna toca el estado de la app por su cuenta. */

/** Inicio: el gancho, la zona de subida y los últimos chats. El mockup 3D del
 * teléfono de la landing no viaja acá — un teléfono dibujado adentro de un
 * teléfono no le dice nada a nadie, y ocupaba media pantalla. */
export function MobileHome({
  copy,
  saved,
  language,
  busyMessage,
  onUpload,
  onOpenSaved,
  onSeeAll,
}: {
  copy: ShellCopy
  saved: SavedAnalysis[]
  language: Language
  busyMessage: string
  onUpload: () => void
  onOpenSaved: (item: SavedAnalysis) => void
  onSeeAll: () => void
}) {
  const m = copy.mobile

  return (
    <>
      <header className="m-hero">
        <p className="eyebrow">{copy.heroCaption}</p>
        <h1>
          {copy.title.prefix} <span className="gradient-text">{copy.title.highlight}</span>
        </h1>
        <p className="lead">{copy.landingSubtitle}</p>
      </header>

      <DropZone copy={copy} busyMessage={busyMessage} onUpload={onUpload} />

      {saved.length > 0 ? (
        <>
          <p className="m-section-label m-section-split">
            <span>{m.home.recent}</span>
            <button type="button" className="m-link" onClick={onSeeAll}>
              {m.home.seeAll}
            </button>
          </p>
          {saved.slice(0, 3).map((item) => (
            <SavedRow key={item.id} item={item} language={language} onOpen={onOpenSaved} />
          ))}
        </>
      ) : null}

      <section className="m-steps-block">
        <p className="m-section-label">{copy.howItWorksTitle}</p>
        <ol className="m-steps">
          {copy.howItWorksSteps.map((step, index) => (
            <li key={step.title}>
              <span className="m-step-n">{index + 1}</span>
              <span className="m-step-body">
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

/** Historial: los análisis guardados. En desktop es una columna lateral que en
 * un teléfono terminaba enterrada abajo de todo; acá tiene pestaña propia. */
export function MobileHistory({
  copy,
  saved,
  language,
  user,
  onOpenSaved,
  onSignIn,
  onUpload,
}: {
  copy: ShellCopy
  saved: SavedAnalysis[]
  language: Language
  user: UserProfile | null
  onOpenSaved: (item: SavedAnalysis) => void
  onSignIn: () => void
  onUpload: () => void
}) {
  const m = copy.mobile

  if (!user) {
    return (
      <div className="m-empty">
        <span className="m-empty-icon">
          <ChatIcon size={26} />
        </span>
        <strong>{copy.savePromptTitle}</strong>
        <p>{copy.savePromptBody}</p>
        <button type="button" className="primary-button" onClick={onSignIn}>
          {copy.login}
        </button>
      </div>
    )
  }

  if (saved.length === 0) {
    return (
      <div className="m-empty">
        <span className="m-empty-icon">
          <UploadIcon size={26} />
        </span>
        <strong>{copy.noSaved}</strong>
        <p>{m.home.empty}</p>
        <button type="button" className="primary-button" onClick={onUpload}>
          {m.uploadAction}
        </button>
      </div>
    )
  }

  return (
    <>
      <p className="m-section-label">
        {saved.length} {copy.savedTitle}
      </p>
      {saved.map((item) => (
        <SavedRow key={item.id} item={item} language={language} onOpen={onOpenSaved} />
      ))}
    </>
  )
}

/** Cuenta: quién sos y en qué estado está tu plan. El detalle completo —cobros,
 * historial, cancelación— sigue viviendo en `SubscriptionPage`, que se abre
 * desde acá y ya es angosta de por sí. */
export function MobileAccount({
  copy,
  language,
  user,
  subscription,
  onSignIn,
  onManage,
  onSignOut,
}: {
  copy: ShellCopy
  language: Language
  user: UserProfile | null
  subscription: SubscriptionOverview | null
  onSignIn: () => void
  onManage: () => void
  onSignOut: () => void
}) {
  const m = copy.mobile

  if (!user) {
    return (
      <div className="m-empty">
        <span className="m-empty-icon">
          <CrownIcon size={24} />
        </span>
        <strong>{copy.vipPopover.signInPrompt}</strong>
        <p>{copy.saveInfo}</p>
        <button type="button" className="primary-button" onClick={onSignIn}>
          {copy.vipPopover.signInCta}
        </button>
      </div>
    )
  }

  const statusLabel = copy.subscriptionPage.statuses[user.subscriptionState as keyof typeof copy.subscriptionPage.statuses] ?? user.subscriptionState
  const statusHint = copy.subscriptionPage.statusHints[user.subscriptionState as keyof typeof copy.subscriptionPage.statusHints]

  return (
    <>
      <div className="m-card m-account-id">
        <span className="m-avatar is-large">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
        </div>
      </div>

      <div className="m-card">
        <div className="m-card-head">
          <strong>{copy.subscriptionPage.currentPlanTitle}</strong>
          <span className={`m-status ${user.hasVipAccess ? 'is-on' : ''}`}>{statusLabel}</span>
        </div>
        {statusHint ? <p className="m-card-hint">{statusHint}</p> : null}
        {subscription?.plan ? (
          <p className="m-card-hint">
            {formatMoney(subscription.plan.amount, subscription.plan.currencyId, language === 'es' ? 'es-AR' : 'en-US')} ·{' '}
            {copy.subscriptionPage.perMonth}
          </p>
        ) : null}
        <button type="button" className="primary-button m-full" onClick={onManage}>
          {user.hasVipAccess ? copy.manageSubscription : copy.unlock}
        </button>
      </div>

      <p className="m-section-label">{m.account.signedInAs}</p>
      <button type="button" className="m-card m-signout" onClick={onSignOut}>
        {copy.logout}
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ */

/** La zona de subida. Toda ella es el botón: en un teléfono no hay hover ni
 * arrastre, así que un recuadro punteado que no se pueda tocar es decorado. */
function DropZone({ copy, busyMessage, onUpload }: { copy: ShellCopy; busyMessage: string; onUpload: () => void }) {
  const m = copy.mobile

  return (
    <button type="button" className={`m-drop ${busyMessage ? 'is-busy' : ''}`} onClick={onUpload} disabled={Boolean(busyMessage)}>
      <span className="m-drop-icon">
        <UploadIcon />
      </span>
      <strong>{busyMessage || m.upload.pick}</strong>
      <span>{m.upload.formats}</span>
      {busyMessage ? null : <span className="m-drop-cue">{m.upload.browse}</span>}
    </button>
  )
}

function SavedRow({
  item,
  language,
  onOpen,
}: {
  item: SavedAnalysis
  language: Language
  onOpen: (item: SavedAnalysis) => void
}) {
  return (
    <button type="button" className="m-saved" onClick={() => onOpen(item)}>
      <span className="m-saved-icon">
        <ChatIcon size={16} />
      </span>
      <span className="m-saved-body">
        <strong>{item.chatName}</strong>
        <span>{item.dateRangeLabel}</span>
        <span>
          {formatNumber(item.messageCount, language)} · {formatNumber(item.participantCount, language)}
        </span>
      </span>
      <span className="m-saved-chevron" aria-hidden="true">
        <ChevronIcon size={15} />
      </span>
    </button>
  )
}
