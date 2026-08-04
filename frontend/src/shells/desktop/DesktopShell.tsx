import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Vistazo } from '../../app/useVistazo'
import { AiConsentModal } from '../../components/AiConsentModal'
import { DevToolbar } from '../../components/DevToolbar'
import { FileUploadZone } from '../../components/FileUploadZone'
import { CrossButton } from '../../components/IconButton'
import { LoadingOverlay } from '../../components/LoadingOverlay'
import { MetricCard } from '../../components/MetricCard'
import { MetricModal } from '../../components/MetricModal'
import { ResponsiveGoogleLogin } from '../../components/ResponsiveGoogleLogin'
import { SubscriptionPage } from '../../components/SubscriptionPage'
import { VipBadge } from '../../components/VipBadge'
import { VipUnlockPopover } from '../../components/VipUnlockPopover'
import { landingMockupStats } from '../../copy/shellCopy'
import { formatNumber } from '../../lib/metrics'
import { useInView } from '../../lib/useInView'
import './desktop.css'

/**
 * El Vistazo de siempre, para monitor. El JSX es exactamente el que vivía en
 * App.tsx: este archivo no rediseñó nada, sólo se lo llevó de lugar.
 *
 * Todo lo que se ve acá sale de , así que desktop y mobile
 * muestran la misma información calculada por el mismo código. Lo único
 * propio de este shell es el estado de presentación de abajo — animaciones y
 * un dropdown que en un teléfono no existen.
 */
export function DesktopShell({ vistazo }: { vistazo: Vistazo }) {
  const {
    language,
    setLanguage,
    copy,
    user,
    token,
    hasGoogleClientId,
    activeChat,
    analysis,
    savedAnalyses,
    interleavedMetrics,
    landingPreviewCards,
    selectedMetric,
    setSelectedMetricId,
    generatedAt,
    showReprocessHint,
    fileInputRef,
    busyMessage,
    analysisProgress,
    error,
    setError,
    aiPanel,
    isAiBusy,
    isConsentModalOpen,
    setIsConsentModalOpen,
    route,
    subscription,
    subscriptionAction,
    subscriptionError,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isVipPopoverOpen,
    setIsVipPopoverOpen,
    showDevTools,
    devAiDisabled,
    isDevBusy,
    navigateTo,
    goToSubscriptionPage,
    openVipPopover,
    requestUnlock,
    openFilePicker,
    processFile,
    handleFileSelection,
    handleGoogleSuccess,
    handleConsentAccept,
    handleLogout,
    handlePurchaseSuccess,
    handleCancelSubscription,
    handleRefreshSubscription,
    handleToggleDevAi,
    handleToggleDevSubscription,
    openSavedAnalysis,
    backToLanding,
  } = vistazo

  // Las secciones de la landing aparecen al entrar en viewport, cada una por
  // su cuenta para que la página se arme por etapas y no toda de golpe.
  const heroReveal = useInView<HTMLElement>()
  const infoReveal = useInView<HTMLElement>()
  const stepsReveal = useInView<HTMLElement>()
  const examplesReveal = useInView<HTMLElement>()
  const uploadReveal = useInView<HTMLElement>()

  // La pantalla del teléfono se inclina hacia el cursor — un parallax 3D
  // chico, amortiguado a ±10deg para que se lea vivo y no como un truco.
  // Depende del mouse, así que es de este shell y de ningún otro.
  const [phoneTilt, setPhoneTilt] = useState({ x: 0, y: 0 })

  function handlePhoneTilt(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const relX = (event.clientX - rect.left) / rect.width - 0.5
    const relY = (event.clientY - rect.top) / rect.height - 0.5
    setPhoneTilt({ x: relY * -12, y: relX * 12 })
  }

  function resetPhoneTilt() {
    setPhoneTilt({ x: 0, y: 0 })
  }

  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  // El dropdown de cuenta no tiene backdrop propio (a diferencia de los
  // modales) — se cierra con cualquier click afuera de la píldora, escuchado
  // en mousedown para no comerse el click que lo abrió ni pelear con lo que
  // ese click de afuera venía a hacer (p. ej. backToLanding).
  useEffect(() => {
    if (!isAccountMenuOpen) {
      return
    }

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isAccountMenuOpen])
  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".txt,.zip"
        onChange={(event) => {
          void handleFileSelection(event)
        }}
      />

      {showDevTools ? (
        <DevToolbar
          copy={copy.dev}
          isAiDisabled={devAiDisabled}
          isVipSimulated={Boolean(subscription?.current?.isDevSimulated && subscription.current.hasAccess)}
          canToggleVip={Boolean(token)}
          isBusy={isDevBusy}
          onToggleAi={handleToggleDevAi}
          onToggleVip={() => {
            void handleToggleDevSubscription()
          }}
        />
      ) : null}

      {route === 'subscription' ? (
        <SubscriptionPage
          language={language}
          copy={copy.subscriptionPage}
          user={user}
          token={token}
          overview={subscription}
          busyAction={subscriptionAction}
          error={subscriptionError}
          onBack={() => navigateTo('/')}
          onLanguageToggle={() => setLanguage((current) => (current === 'es' ? 'en' : 'es'))}
          onStartPurchase={openVipPopover}
          onPurchaseSuccess={(overview) => {
            void handlePurchaseSuccess(overview)
          }}
          onCancel={() => {
            void handleCancelSubscription()
          }}
          onRefresh={() => {
            void handleRefreshSubscription()
          }}
          onSignIn={() => setIsAuthModalOpen(true)}
        />
      ) : (
        <>
      <header className="topbar">
        <button type="button" className="brand-mark" onClick={backToLanding}>
          <span className="brand-orb" />
          <div>
            <strong>Vistazo</strong>
            <small>{copy.heroCaption}</small>
          </div>
        </button>

        <div className="topbar-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setLanguage((current) => (current === 'es' ? 'en' : 'es'))}
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>

          {user ? (
            <div className="user-pill" ref={accountMenuRef}>
              <button
                type="button"
                className="user-avatar-button"
                onClick={() => setIsAccountMenuOpen((open) => !open)}
                aria-expanded={isAccountMenuOpen}
                aria-label={copy.account}
              >
                {user.displayName.slice(0, 1).toUpperCase()}
              </button>
              <CrossButton label={copy.logout} onClick={handleLogout} />

              {isAccountMenuOpen ? (
                <div id="account-info" className="account-menu">
                  <p className="account-name">{user.displayName}</p>
                  <p>{user.email}</p>
                  <p>
                    {copy.subscription}:{' '}
                    <strong>{translateStatus(copy.subscriptionPage.statuses, user.subscriptionState)}</strong>
                  </p>
                  <VipBadge active={user.hasVipAccess} label={user.hasVipAccess ? copy.vipOn : copy.vipOff} compact />

                  <button type="button" className="account-menu-action" onClick={goToSubscriptionPage}>
                    {copy.manageSubscription}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" className="icon-button" onClick={() => setIsAuthModalOpen(true)}>
              <span aria-hidden="true">⇢</span>
              <span>{copy.login}</span>
            </button>
          )}
        </div>
      </header>

      {!hasGoogleClientId ? <p className="warning-banner">{copy.setupWarning}</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}

      {analysis ? (
        <main className="analytics-layout">
          <section className="analytics-hero panel">
            <div>
              <p className="eyebrow">{analysis.chatName}</p>
              <h1>{copy.metricsTitle}</h1>
              <p className="lead">{copy.metricsSubtitle}</p>
            </div>

            <div className="analytics-hero-actions">
              <button type="button" className="primary-button" onClick={openFilePicker}>
                {busyMessage ? busyMessage : copy.uploadCta}
              </button>
            </div>
          </section>

          <div className="analytics-summary-row">
            <section className="analytics-main">
              {activeChat && !user ? (
                <div className="save-prompt">
                  <span className="save-prompt-icon" aria-hidden="true">
                    <SaveIcon />
                  </span>
                  <div className="save-prompt-copy">
                    <strong>{copy.savePromptTitle}</strong>
                    <p>{copy.savePromptBody}</p>
                  </div>
                  <button type="button" className="primary-button" onClick={() => setIsAuthModalOpen(true)}>
                    {copy.login}
                  </button>
                </div>
              ) : null}
              {showReprocessHint ? <p className="warning-banner">{copy.reprocessHint}</p> : null}

              <section className="panel summary-panel">
                <div className="summary-header">
                  <div>
                    <p className="eyebrow">{analysis.dateRangeLabel}</p>
                    <h2>{copy.chatSummaryTitle}</h2>
                  </div>
                  <VipBadge active={Boolean(user?.hasVipAccess)} label={user?.hasVipAccess ? copy.vipOn : copy.vipOff} />
                </div>

                <div className="summary-stats">
                  <Stat label={copy.messages} value={formatNumber(analysis.messageCount, language)} />
                  <Stat label={copy.participants} value={formatNumber(analysis.participantCount, language)} />
                  <Stat label={copy.generatedAt} value={generatedAt} />
                </div>

                <div className="participant-list">
                  {analysis.participants.map((participant) => (
                    <span key={participant} className="participant-chip">
                      {participant}
                    </span>
                  ))}
                </div>
              </section>
            </section>

            <aside className="analytics-sidebar">
              <section className="panel history-panel">
                <h2>{copy.savedTitle}</h2>
                {savedAnalyses.length === 0 ? <p>{copy.noSaved}</p> : null}
                <div className="history-list">
                  {savedAnalyses.map((item) => (
                    <button key={item.id} type="button" className="history-item" onClick={() => openSavedAnalysis(item)}>
                      <strong>{item.chatName}</strong>
                      <span>{item.dateRangeLabel}</span>
                      <span>
                        {formatNumber(item.messageCount, language)} · {formatNumber(item.participantCount, language)}
                      </span>
                      <em>{copy.openSaved}</em>
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <section className="panel metric-panel">
            <div className="metric-list">
              {chunk(interleavedMetrics, 3).map((row, rowIndex) => (
                <div className="metric-row" key={rowIndex}>
                  {row.map((card, indexInRow) => (
                    <div
                      key={card.id}
                      className="metric-list-item"
                      style={{ animationDelay: `${(rowIndex * 3 + indexInRow) * 45}ms` }}
                    >
                      <MetricCard
                        card={card}
                        seeMoreLabel={copy.seeMore}
                        unlockLabel={copy.unlock}
                        ai={aiPanel}
                        onOpen={(selected) => setSelectedMetricId(selected.id)}
                        onUnlock={requestUnlock}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </main>
      ) : user ? (
        <main className="full-wrapped-layout">
          <section className="full-wrapped-hero">
            <div>
              <p className="eyebrow">{copy.heroCaption}</p>
              <h1>{copy.metricsTitle}</h1>
              <p className="lead">{copy.savedTitle}</p>
            </div>
          </section>

          <FileUploadZone
            onFileSelect={processFile}
            isLoading={Boolean(busyMessage)}
            loadingMessage={busyMessage}
          />

          <section className="panel full-wrapped-content">
            <h2>{copy.savedTitle}</h2>
            {savedAnalyses.length === 0 ? (
              <p>{copy.noSaved}</p>
            ) : (
              <div className="history-list">
                {savedAnalyses.map((item) => (
                  <button key={item.id} type="button" className="history-item" onClick={() => openSavedAnalysis(item)}>
                    <strong>{item.chatName}</strong>
                    <span>{item.dateRangeLabel}</span>
                    <span>
                      {formatNumber(item.messageCount, language)} · {formatNumber(item.participantCount, language)}
                    </span>
                    <em>{copy.openSaved}</em>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="landing-layout">
          <div className="ambient-blobs" aria-hidden="true">
            <span className="ambient-blob blob-a" />
            <span className="ambient-blob blob-b" />
            <span className="ambient-blob blob-c" />
          </div>

          <section className="landing-hero" ref={heroReveal.ref}>
            <div className={`landing-copy reveal ${heroReveal.inView ? 'is-visible' : ''}`}>
              <p className="eyebrow">{copy.heroCaption}</p>
              <h1>
                {copy.title.prefix} <span className="gradient-text">{copy.title.highlight}</span>
              </h1>
              <p className="lead">{copy.landingSubtitle}</p>

              <div className="landing-actions">
                <button type="button" className="primary-button" onClick={openFilePicker}>
                  {busyMessage || copy.startNow}
                </button>
                {!user ? (
                  <button type="button" className="ghost-button" onClick={() => setIsAuthModalOpen(true)}>
                    {copy.login}
                  </button>
                ) : null}
              </div>

              <ul className="trust-strip">
                {copy.trustBadges.map((badge) => (
                  <li key={badge}>{badge}</li>
                ))}
              </ul>
            </div>

            <div
              className={`landing-visual reveal ${heroReveal.inView ? 'is-visible' : ''}`}
              onMouseMove={handlePhoneTilt}
              onMouseLeave={resetPhoneTilt}
            >
              <div className="phone-mockup">
                <div
                  className="phone-screen"
                  style={{ transform: `rotateX(${phoneTilt.x}deg) rotateY(${phoneTilt.y}deg)` }}
                >
                  <div className="mockup-glow" />
                  {landingMockupStats[language].map((stat, index) => (
                    <div key={stat.label} className={`mockup-stat stat-${['a', 'b', 'c'][index]}`}>
                      <strong>{stat.value}</strong>
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <span className="floating-chip chip-1" aria-hidden="true">
                😂
              </span>
              <span className="floating-chip chip-2" aria-hidden="true">
                🚩
              </span>
              <span className="floating-chip chip-3" aria-hidden="true">
                🔥
              </span>
            </div>
          </section>

          <div className="marquee" aria-hidden="true">
            <div className="marquee-track">
              {[...copy.marqueeItems, ...copy.marqueeItems].map((item, index) => (
                <span className="marquee-item" key={index}>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <section className={`panel landing-info reveal ${infoReveal.inView ? 'is-visible' : ''}`} ref={infoReveal.ref}>
            <div>
              <h2>{copy.whatItDoesTitle}</h2>
              <p className="panel-copy">{copy.whatItDoesBody}</p>
            </div>

            <h3 className="why-heading">{copy.whyTitle}</h3>

            <div className="why-grid">
              {copy.whyCards.map((item, index) => (
                <article
                  key={item.title}
                  className={`why-card reveal-child ${infoReveal.inView ? 'is-visible' : ''}`}
                  style={{ transitionDelay: `${index * 90}ms` }}
                >
                  <span className="why-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={`panel steps-section reveal ${stepsReveal.inView ? 'is-visible' : ''}`} ref={stepsReveal.ref}>
            <h2>{copy.howItWorksTitle}</h2>
            <div className="steps-grid">
              {copy.howItWorksSteps.map((step, index) => (
                <article
                  key={step.title}
                  className={`step-card reveal-child ${stepsReveal.inView ? 'is-visible' : ''}`}
                  style={{ transitionDelay: `${index * 90}ms` }}
                >
                  <span className="step-number">{index + 1}</span>
                  <h4>{step.title}</h4>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={`examples-section reveal ${examplesReveal.inView ? 'is-visible' : ''}`} ref={examplesReveal.ref}>
            <div className="section-heading">
              <h2>{copy.examplesTitle}</h2>
              <p className="panel-copy">{copy.examplesSubtitle}</p>
            </div>

            {chunk(landingPreviewCards, 3).map((row, rowIndex) => (
              <div className="metric-row" key={rowIndex}>
                {row.map((card, indexInRow) => (
                  <div
                    key={card.id}
                    className={`metric-list-item demo-card-wrapper reveal-child ${examplesReveal.inView ? 'is-visible' : ''}`}
                    style={{ transitionDelay: `${(rowIndex * 3 + indexInRow) * 80}ms` }}
                  >
                    <span className="demo-tag">{copy.demoTag}</span>
                    <MetricCard
                      card={card}
                      seeMoreLabel={copy.seeMore}
                      unlockLabel={copy.unlock}
                      onOpen={(selected) => setSelectedMetricId(selected.id)}
                      onUnlock={requestUnlock}
                    />
                  </div>
                ))}
              </div>
            ))}
          </section>

          <section className={`upload-strip-section reveal ${uploadReveal.inView ? 'is-visible' : ''}`} ref={uploadReveal.ref}>
            <div className="upload-strip-info">
              <h2>{copy.uploadTitle}</h2>
              <p className="panel-copy">{copy.saveInfo}</p>
              <p className="panel-copy upload-strip-hint">{copy.uploadHint}</p>
            </div>

            <FileUploadZone
              onFileSelect={processFile}
              isLoading={Boolean(busyMessage)}
              loadingMessage={busyMessage}
            />
          </section>
        </main>
      )}

      <footer className="app-footer">
        <div className="brand-mark footer-brand">
          <span className="brand-orb" />
          <strong>Vistazo</strong>
        </div>
        <p className="footer-privacy">{copy.footerPrivacy}</p>
        <p className="footer-meta">
          © {new Date().getFullYear()} Vistazo · {copy.footerRights}
        </p>
      </footer>
        </>
      )}

      {isAuthModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsAuthModalOpen(false)}>
          <section className="modal-card auth-modal" onClick={(event) => event.stopPropagation()}>
            <CrossButton label={copy.close} onClick={() => setIsAuthModalOpen(false)} className="close-button" />
            <p className="eyebrow">Google Login</p>
            <h2>{copy.loginHeadline}</h2>

            <p className="panel-copy">{activeChat ? copy.loginAfterUpload : copy.saveInfo}</p>
            {hasGoogleClientId ? (
              <ResponsiveGoogleLogin
                onSuccess={(credentialResponse) => {
                  void handleGoogleSuccess(credentialResponse)
                }}
                onError={() => setError(copy.loadError)}
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {isVipPopoverOpen ? (
        <VipUnlockPopover
          copy={{ ...copy.subscriptionPage, ...copy.vipPopover }}
          user={user}
          token={token}
          plan={subscription?.plan ?? null}
          overview={subscription}
          onClose={() => setIsVipPopoverOpen(false)}
          onSignIn={() => {
            setIsVipPopoverOpen(false)
            setIsAuthModalOpen(true)
          }}
          onSuccess={(overview) => {
            void handlePurchaseSuccess(overview)
          }}
        />
      ) : null}

      {selectedMetric ? (
        <MetricModal
          card={selectedMetric}
          copy={{
            close: copy.close,
            detailTitle: copy.detailTitle,
            breakdownTitle: copy.breakdownTitle,
            showMore: copy.showMore,
            unlock: copy.unlock,
            searchPlaceholder: copy.searchPlaceholder,
          }}
          ai={aiPanel}
          onClose={() => setSelectedMetricId(null)}
          onUnlock={requestUnlock}
        />
      ) : null}

      {isConsentModalOpen ? (
        <AiConsentModal
          copy={{ ...copy.consent, close: copy.close }}
          isBusy={isAiBusy}
          onAccept={() => {
            void handleConsentAccept()
          }}
          onDismiss={() => setIsConsentModalOpen(false)}
        />
      ) : null}

      {busyMessage ? (
        <LoadingOverlay title={busyMessage} subtitle={copy.overlaySubtitle} progress={analysisProgress} />
      ) : null}
    </div>
  )
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** The backend sends the subscription status as a plain string, while the copy tables are
 * `as const` literals — this is the widening step between the two. */
function translateStatus(statuses: Record<string, string>, status: string): string {
  return statuses[status] ?? status
}

/** Reparte las tarjetas en filas de a `size`. Es la grilla de desktop: en un
 * teléfono las métricas van en una sola columna y esto no hace falta. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}
