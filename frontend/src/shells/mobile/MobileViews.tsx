import { ChartRenderer } from '../../components/charts/ChartRenderer'
import type { ShellCopy } from '../../copy/shellCopy'
import { formatMoney } from '../../lib/format'
import { formatNumber } from '../../lib/metrics'
import type { Language, MetricCard, SavedAnalysis, SubscriptionOverview, UserProfile } from '../../types'
import { ChatIcon, ChevronIcon, CrownIcon, PencilIcon, TrashIcon, UploadIcon } from './icons'

/* Las cuatro vistas de las pestañas. Son composición pura: cualquier dato o
   acción llega por props desde `MobileShell`, que a su vez lo saca de
   `useVistazo()`. Ninguna toca el estado de la app por su cuenta. */

/** Inicio: el gancho, la zona de subida y los últimos chats. El mockup 3D del
 * teléfono de la landing no viaja acá — un teléfono dibujado adentro de un
 * teléfono no le dice nada a nadie, y ocupaba media pantalla. */
export function MobileHome({
  copy,
  saved,
  isLoadingSaved,
  language,
  busyMessage,
  demoCards,
  onUpload,
  onOpenDemo,
  onOpenSaved,
  onDeleteSaved,
  onRenameSaved,
  onSeeAll,
}: {
  copy: ShellCopy
  saved: SavedAnalysis[]
  /** Hay sesión pero la lista todavía no llegó: no se sabe si corresponden los ejemplos
   * o los chats recientes, así que se dibuja el esqueleto de los segundos. */
  isLoadingSaved: boolean
  language: Language
  busyMessage: string
  /** Las tarjetas de ejemplo de la landing (ver buildLandingPreviewCards). Vacías
   * mientras el worker las calcula. */
  demoCards: MetricCard[]
  onUpload: () => void
  onOpenDemo: (card: MetricCard) => void
  onOpenSaved: (item: SavedAnalysis) => void
  onDeleteSaved: (item: SavedAnalysis) => void
  onRenameSaved: (item: SavedAnalysis) => void
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

      {/* Quien ya tiene chats guardados ya sabe cómo se ve un resultado: los ejemplos
          son para el que todavía no subió nada. Hasta que llega la lista no se sabe cuál
          de los dos es, y adelantar los ejemplos es lo que hacía parecer que no había
          sesión: a los dos segundos se cambiaban por los chats de siempre. */}
      {isLoadingSaved ? (
        <SavedSkeleton label={copy.savedLoading} rows={2} withLabel />
      ) : saved.length === 0 && demoCards.length > 0 ? (
        <DemoCarousel copy={copy} cards={demoCards} onOpen={onOpenDemo} />
      ) : null}

      {!isLoadingSaved && saved.length > 0 ? (
        <>
          <p className="m-section-label m-section-split">
            <span>{m.home.recent}</span>
            <button type="button" className="m-link" onClick={onSeeAll}>
              {m.home.seeAll}
            </button>
          </p>
          {saved.slice(0, 3).map((item) => (
            <SavedRow
              key={item.id}
              item={item}
              language={language}
              copy={copy}
              onOpen={onOpenSaved}
              onDelete={onDeleteSaved}
              onRename={onRenameSaved}
            />
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

      {/* Links de verdad a las páginas de contenido (seo/), que sólo existen en español:
          es por donde Google llega a ellas desde la portada. */}
      {language === 'es' ? (
        <nav className="m-seo-links" aria-label={copy.footerGuides}>
          <a href="/guias">{copy.footerGuides}</a>
          <a href="/metricas">{copy.footerMetrics}</a>
          <a href="/preguntas-frecuentes">{copy.footerFaq}</a>
        </nav>
      ) : null}
    </>
  )
}

/** Historial: los análisis guardados. En desktop es una columna lateral que en
 * un teléfono terminaba enterrada abajo de todo; acá tiene pestaña propia. */
export function MobileHistory({
  copy,
  saved,
  isLoading,
  language,
  user,
  onOpenSaved,
  onDeleteSaved,
  onRenameSaved,
  onSignIn,
  onUpload,
}: {
  copy: ShellCopy
  saved: SavedAnalysis[]
  /** La lista todavía no llegó del servidor: ni "iniciá sesión" ni "no hay nada". */
  isLoading: boolean
  language: Language
  user: UserProfile | null
  onOpenSaved: (item: SavedAnalysis) => void
  onDeleteSaved: (item: SavedAnalysis) => void
  onRenameSaved: (item: SavedAnalysis) => void
  onSignIn: () => void
  onUpload: () => void
}) {
  const m = copy.mobile

  // Primero que nada: con sesión pero sin lista todavía, tampoco se sabe si hay perfil
  // (un token sin copia guardada) — decir "iniciá sesión" o "no hay análisis" sería
  // anunciar algo que en un segundo puede resultar falso.
  if (isLoading) {
    return <SavedSkeleton label={copy.savedLoading} rows={3} />
  }

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
        <SavedRow
          key={item.id}
          item={item}
          language={language}
          copy={copy}
          onOpen={onOpenSaved}
          onDelete={onDeleteSaved}
          onRename={onRenameSaved}
        />
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
  isRestoring,
  subscription,
  onSignIn,
  onManage,
  onSignOut,
}: {
  copy: ShellCopy
  language: Language
  user: UserProfile | null
  /** Hay token pero todavía no perfil (ni siquiera uno guardado): se confirma la sesión. */
  isRestoring: boolean
  subscription: SubscriptionOverview | null
  onSignIn: () => void
  onManage: () => void
  onSignOut: () => void
}) {
  const m = copy.mobile

  if (!user && isRestoring) {
    return (
      <div className="m-card m-account-id" aria-hidden="true">
        <span className="m-avatar is-large is-placeholder" />
        <div className="m-skeleton-lines">
          <i className="skeleton-bar" style={{ width: '52%' }} />
          <i className="skeleton-bar" style={{ width: '78%' }} />
        </div>
      </div>
    )
  }

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
  // An admin's Pro is not a subscription: "se renueva sola todos los meses" next to it
  // described a charge that does not exist.
  const statusHint = user.isAdmin
    ? copy.subscriptionPage.adminNote
    : copy.subscriptionPage.statusHints[user.subscriptionState as keyof typeof copy.subscriptionPage.statusHints]

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

/** Ejemplos deslizables: las mismas tarjetas que la landing de desktop, con las
 * métricas reales corriendo sobre un chat inventado. Tocar una abre la misma hoja de
 * detalle que una métrica propia, con los mensajes de adentro. */
function DemoCarousel({ copy, cards, onOpen }: { copy: ShellCopy; cards: MetricCard[]; onOpen: (card: MetricCard) => void }) {
  return (
    <section className="m-demo">
      <div className="m-demo-head">
        <p className="m-section-label">{copy.examplesTitle}</p>
      </div>
      <div className="m-demo-track">
        {cards.map((card) => (
          <button key={card.id} type="button" className={`m-demo-card ${card.accent}`} onClick={() => onOpen(card)}>
            <span className="m-demo-tag">{copy.demoTag}</span>
            <span className="m-demo-title">{card.title}</span>
            <strong className="m-demo-value">{card.basic?.value}</strong>
            <span className="m-demo-label">{card.basic?.label}</span>
            {card.basic?.chart ? (
              <span className="m-demo-chart" aria-hidden="true">
                <ChartRenderer chart={card.basic.chart} compact />
              </span>
            ) : null}
            <span className="m-demo-foot">
              {card.tier === 'vip' ? (
                <span className="m-demo-tier">
                  <CrownIcon /> {copy.proTag}
                </span>
              ) : (
                <span />
              )}
              <span className="m-demo-more">
                {copy.seeMore} <ChevronIcon size={13} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

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

/** Lo que ocupa el lugar de los chats guardados mientras llega la lista (ver
 * `isLoadingAnalyses` en useVistazo): filas con la forma de las reales. Las barras son
 * decorado; el aviso para el lector de pantalla va en la etiqueta del contenedor. */
function SavedSkeleton({ label, rows, withLabel = false }: { label: string; rows: number; withLabel?: boolean }) {
  return (
    <div className="m-saved-skeleton" role="status" aria-busy="true" aria-label={label}>
      {withLabel ? <i className="skeleton-bar m-saved-skeleton-label" aria-hidden="true" /> : null}
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="m-saved-row m-saved-row-skeleton" aria-hidden="true">
          <span className="m-saved-icon" />
          <span className="m-skeleton-lines">
            <i className="skeleton-bar" style={{ width: index % 2 === 0 ? '58%' : '46%' }} />
            <i className="skeleton-bar" style={{ width: '82%' }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function SavedRow({
  item,
  language,
  copy,
  onOpen,
  onDelete,
  onRename,
}: {
  item: SavedAnalysis
  language: Language
  copy: ShellCopy
  onOpen: (item: SavedAnalysis) => void
  onDelete: (item: SavedAnalysis) => void
  onRename: (item: SavedAnalysis) => void
}) {
  return (
    /* La papelera y el lápiz son botones aparte, hermanos del que abre — no pueden
       ir adentro, porque un botón dentro de otro botón no es HTML válido y en un
       teléfono terminaría abriendo el análisis en vez de renombrarlo o borrarlo.
       La fila entera comparte un solo borde (ver .m-saved-row en mobile.css), así
       que a pesar de ser tres <button> se ve como una sola tarjeta. */
    <div className="m-saved-row">
      <button type="button" className="m-saved" onClick={() => onOpen(item)}>
        <span className="m-saved-icon">
          <ChatIcon size={16} />
        </span>
        <span className="m-saved-body">
          <strong>{item.chatName}</strong>
          <span>{item.dateRangeLabel}</span>
          {/* Antes decía "1.234 · 4", sin aclarar de qué eran esos números. */}
          <span>
            {formatNumber(item.messageCount, language)} {copy.messages.toLowerCase()} ·{' '}
            {formatNumber(item.participantCount, language)} {copy.participants.toLowerCase()}
          </span>
        </span>
        <span className="m-saved-chevron" aria-hidden="true">
          <ChevronIcon size={15} />
        </span>
      </button>

      <button
        type="button"
        className="m-saved-action"
        onClick={() => onRename(item)}
        aria-label={`${copy.renameSaved}: ${item.chatName}`}
      >
        <PencilIcon size={15} />
      </button>

      <button
        type="button"
        className="m-saved-action is-danger"
        onClick={() => onDelete(item)}
        aria-label={`${copy.deleteSaved}: ${item.chatName}`}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  )
}
