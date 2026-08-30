import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Vistazo } from '../../app/useVistazo'
import { AiConsentModal } from '../../components/AiConsentModal'
import { DevToolbar } from '../../components/DevToolbar'
import { ErrorBanner } from '../../components/ErrorBanner'
import { ExportTutorialModal } from '../../components/ExportTutorialModal'
import { FileUploadZone } from '../../components/FileUploadZone'
import { FreeUnlockConfirm } from '../../components/FreeUnlockConfirm'
import { CrossButton } from '../../components/IconButton'
import { LoadingOverlay } from '../../components/LoadingOverlay'
import { LockedPanel } from '../../components/LockedPanel'
import { MetricCard } from '../../components/MetricCard'
import { MetricModal } from '../../components/MetricModal'
import { ModalShell } from '../../components/ModalShell'
import { useEditableWordCloud } from '../../components/useEditableWordCloud'
import { RecaptchaChallenge } from '../../components/RecaptchaChallenge'
import { RecaptchaNotice } from '../../components/RecaptchaNotice'
import { ResponsiveGoogleLogin } from '../../components/ResponsiveGoogleLogin'
import { SubscriptionPage } from '../../components/SubscriptionPage'
import { VipBadge } from '../../components/VipBadge'
import { VipUnlockPopover } from '../../components/VipUnlockPopover'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { RenameDialog } from '../../components/RenameDialog'
import { landingMockupStats, type ShellCopy } from '../../copy/shellCopy'
import { formatNumber } from '../../lib/metrics'
import { useInView } from '../../lib/useInView'
import { usePwaInstall } from '../../lib/usePwaInstall'
import type { Language, SavedAnalysis } from '../../types'
import './desktop.css'

/**
 * El Vistazo de siempre, para monitor. El JSX es exactamente el que vivía en
 * App.tsx: este archivo no rediseñó nada, sólo se lo llevó de lugar.
 *
 * Todo lo que se ve acá sale de `useVistazo()`, así que desktop y mobile
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
    persistWordCloudEdit,
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
    needsRecaptchaChallenge,
    recaptchaSiteKeyV2,
    recaptchaSiteKeyV3,
    isExportTutorialOpen,
    setIsExportTutorialOpen,
    isVipPopoverOpen,
    setIsVipPopoverOpen,
    freeUnlocks,
    freeUnlockFor,
    pendingFreeUnlockMetric,
    revealingFreeUnlockId,
    confirmFreeUnlock,
    cancelFreeUnlock,
    showDevTools,
    devAiDisabled,
    devRecaptchaV3Disabled,
    isDevBusy,
    navigateTo,
    goToSubscriptionPage,
    requestUnlock,
    requestUpload,
    openFilePicker,
    processFile,
    handleFileSelection,
    handleGoogleSuccess,
    handleRecaptchaChallengeSuccess,
    handleConsentAccept,
    handleLogout,
    handleCancelSubscription,
    handleRefreshSubscription,
    handleToggleDevAi,
    handleToggleDevRecaptchaV3,
    handleToggleDevSubscription,
    handleResetDevFreeUnlocks,
    openSavedAnalysis,
    pendingDeleteAnalysis,
    isDeletingAnalysis,
    requestDeleteAnalysis,
    cancelDeleteAnalysis,
    confirmDeleteAnalysis,
    pendingRenameAnalysis,
    isRenamingAnalysis,
    requestRenameAnalysis,
    cancelRenameAnalysis,
    confirmRenameAnalysis,
    backToLanding,
  } = vistazo

  // Called here rather than inside MetricModal so its state survives the modal
  // closing and reopening — this shell stays mounted for the whole session, the
  // modal doesn't. `resetKey` sticks to the last selected card's id instead of
  // following `selectedMetric` straight through `null` while the modal is closed,
  // so it only actually clears the editor when the *next* card opened is a
  // different one, or `sourceHash` changes (a new upload replacing the chat).
  const wordCloudCardIdRef = useRef<string | null>(null)
  if (selectedMetric) {
    wordCloudCardIdRef.current = selectedMetric.id
  }
  const wordCloudEditor = useEditableWordCloud({
    chart: selectedMetric?.basic?.chart,
    series: selectedMetric?.detail?.series,
    messages: activeChat?.messages,
    resetKey: `${analysis?.sourceHash ?? ''}:${wordCloudCardIdRef.current ?? ''}`,
    copy: copy.wordCloudSearch,
    onEdit: (chart, series) => {
      if (wordCloudCardIdRef.current) {
        void persistWordCloudEdit(wordCloudCardIdRef.current, chart, series)
      }
    },
  })

  // Las secciones de la landing aparecen al entrar en viewport, cada una por
  // su cuenta para que la página se arme por etapas y no toda de golpe.
  const heroReveal = useInView<HTMLElement>()
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

  /* Instalar la app sólo se ofrecía desde un paso del tutorial de exportación, que
     quien ya sabe exportar nunca abre. Acá está donde vive el resto de lo que es
     "de la cuenta", y sólo cuando el navegador tiene el prompt listo. */
  const { canInstall: canInstallApp, install: installApp } = usePwaInstall()

  /* Baja a las 25 tarjetas memoizadas: escrito inline sería un handler nuevo en
     cada render y el memo no serviría de nada. setSelectedMetricId es un setter
     de estado, así que su identidad ya es estable. */
  const openMetricDetail = useCallback(
    (selected: { id: string }) => setSelectedMetricId(selected.id),
    [setSelectedMetricId],
  )

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
          canResetUnlocks={Boolean(token) && !user?.hasVipAccess}
          isRecaptchaV3Disabled={devRecaptchaV3Disabled}
          isBusy={isDevBusy}
          onToggleAi={handleToggleDevAi}
          onToggleVip={() => {
            void handleToggleDevSubscription()
          }}
          onResetUnlocks={() => {
            void handleResetDevFreeUnlocks()
          }}
          onToggleRecaptchaV3={handleToggleDevRecaptchaV3}
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

                  {canInstallApp ? (
                    <button
                      type="button"
                      className="account-menu-action"
                      onClick={() => {
                        void installApp()
                      }}
                    >
                      {copy.installApp}
                    </button>
                  ) : null}
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
      {error ? <ErrorBanner message={error} dismissLabel={copy.dismissError} onDismiss={() => setError('')} /> : null}

      {analysis && user ? (
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
                <HistoryList
                  items={savedAnalyses}
                  language={language}
                  copy={copy}
                  onOpen={openSavedAnalysis}
                  onDelete={requestDeleteAnalysis}
                  onRename={requestRenameAnalysis}
                />
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
                      style={{ animationDelay: `${(rowIndex * 3 + indexInRow) * 65}ms` }}
                    >
                      <MetricCard
                        card={card}
                        seeMoreLabel={copy.seeMore}
                        unlockLabel={copy.unlock}
                        ai={aiPanel}
                        onOpen={openMetricDetail}
                        onUnlock={requestUnlock}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </main>
      ) : analysis && !user ? (
        <main className="analytics-layout">
          <section className="analytics-hero panel">
            <div>
              <p className="eyebrow">{copy.heroCaption}</p>
              <h1>{copy.metricsTitle}</h1>
              <p className="lead">{copy.metricsSubtitle}</p>
            </div>
          </section>

          <LockedPanel
            tall
            preview={copy.loginRequiredPreview}
            unlockLabel={copy.login}
            onUnlock={() => setIsAuthModalOpen(true)}
          />
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
            copy={copy.uploadZone}
            onFileSelect={processFile}
            isLoading={Boolean(busyMessage)}
            loadingMessage={busyMessage}
          />

          <section className="panel full-wrapped-content">
            <h2>{copy.savedTitle}</h2>
            {savedAnalyses.length === 0 ? (
              <p>{copy.noSaved}</p>
            ) : (
              <HistoryList
                items={savedAnalyses}
                language={language}
                copy={copy}
                onOpen={openSavedAnalysis}
                onDelete={requestDeleteAnalysis}
                onRename={requestRenameAnalysis}
              />
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
                <button type="button" className="primary-button" onClick={requestUpload}>
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
              copy={copy.uploadZone}
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
        <ModalShell
          onDismiss={() => setIsAuthModalOpen(false)}
          label={needsRecaptchaChallenge ? copy.recaptchaChallengeTitle : copy.loginHeadline}
          className="auth-modal"
          closeLabel={copy.close}
        >
            {needsRecaptchaChallenge ? (
              <RecaptchaChallenge
                siteKey={recaptchaSiteKeyV2}
                title={copy.recaptchaChallengeTitle}
                body={copy.recaptchaChallengeBody}
                onSolved={(token) => {
                  void handleRecaptchaChallengeSuccess(token)
                }}
              />
            ) : (
              <>
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
              </>
            )}
            {recaptchaSiteKeyV3 ? <RecaptchaNotice language={language} /> : null}
        </ModalShell>
      ) : null}

      {isVipPopoverOpen ? (
        <VipUnlockPopover
          copy={{ ...copy.subscriptionPage, ...copy.vipPopover }}
          language={language}
          user={user}
          token={token}
          plan={subscription?.plan ?? null}
          overview={subscription}
          onClose={() => setIsVipPopoverOpen(false)}
          onSignIn={() => {
            setIsVipPopoverOpen(false)
            setIsAuthModalOpen(true)
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
            freeUnlockLoading: copy.freeUnlock.loading,
            wordCloudSearch: copy.wordCloudSearch,
          }}
          ai={aiPanel}
          freeUnlock={freeUnlockFor(selectedMetric)}
          isRevealingFreeUnlock={revealingFreeUnlockId === selectedMetric.id}
          messages={activeChat?.messages}
          wordCloudEditor={wordCloudEditor}
          onClose={() => setSelectedMetricId(null)}
          onUnlock={requestUnlock}
        />
      ) : null}

      {/* Encima del modal de la métrica a propósito: el desbloqueo se pide desde
          ahí y la confirmación tiene que quedar por delante de lo que la abrió. */}
      {pendingFreeUnlockMetric && freeUnlocks ? (
        <FreeUnlockConfirm
          copy={{
            eyebrow: copy.freeUnlock.confirmEyebrow,
            title: copy.freeUnlock.confirmTitle,
            body: copy.freeUnlock.confirmBody,
            metricLine: copy.freeUnlock.confirmMetric,
            confirm: copy.freeUnlock.confirmCta,
            cancel: copy.freeUnlock.cancel,
            close: copy.close,
          }}
          metricTitle={pendingFreeUnlockMetric.title}
          remaining={freeUnlocks.remaining}
          dailyLimit={freeUnlocks.dailyLimit}
          onConfirm={() => {
            void confirmFreeUnlock()
          }}
          onCancel={cancelFreeUnlock}
        />
      ) : null}

      {pendingDeleteAnalysis ? (
        <ConfirmDialog
          copy={{
            title: copy.deleteSavedTitle,
            body: copy.deleteSavedConfirm.replace('{chat}', pendingDeleteAnalysis.chatName),
            confirm: copy.deleteSavedCta,
            cancel: copy.deleteSavedCancel,
            busy: copy.deleting,
            close: copy.close,
          }}
          isBusy={isDeletingAnalysis}
          onConfirm={() => {
            void confirmDeleteAnalysis()
          }}
          onCancel={cancelDeleteAnalysis}
        />
      ) : null}

      {pendingRenameAnalysis ? (
        <RenameDialog
          copy={{
            title: copy.renameSavedTitle,
            label: copy.renameSavedLabel,
            placeholder: copy.renameSavedPlaceholder,
            save: copy.renameSavedCta,
            cancel: copy.renameSavedCancel,
            busy: copy.renaming,
            close: copy.close,
          }}
          initialValue={pendingRenameAnalysis.chatName}
          isBusy={isRenamingAnalysis}
          onSave={(chatName) => {
            void confirmRenameAnalysis(chatName)
          }}
          onCancel={cancelRenameAnalysis}
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

      {isExportTutorialOpen ? (
        <ExportTutorialModal
          copy={{ ...copy.exportTutorial, close: copy.close }}
          onClose={() => setIsExportTutorialOpen(false)}
          onPick={() => {
            setIsExportTutorialOpen(false)
            openFilePicker()
          }}
        />
      ) : null}

      {busyMessage ? (
        <LoadingOverlay title={busyMessage} subtitle={copy.overlaySubtitle} progress={analysisProgress} />
      ) : null}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/** El historial guardado. Vivía escrito dos veces —una en la barra lateral del
 * análisis y otra en la pantalla de "todavía no subiste nada"— con el mismo JSX
 * copiado; ahora es uno solo, que es lo que permitió agregarle el borrado en los
 * dos lugares a la vez. */
function HistoryList({
  items,
  language,
  copy,
  onOpen,
  onDelete,
  onRename,
}: {
  items: SavedAnalysis[]
  language: Language
  copy: ShellCopy
  onOpen: (item: SavedAnalysis) => void
  onDelete: (item: SavedAnalysis) => void
  onRename: (item: SavedAnalysis) => void
}) {
  return (
    <div className="history-list">
      {items.map((item) => (
        <div key={item.id} className="history-row">
          <button type="button" className="history-item" onClick={() => onOpen(item)}>
            <strong>{item.chatName}</strong>
            <span>{item.dateRangeLabel}</span>
            {/* Antes decía "1.234 · 4", sin aclarar de qué eran esos números. */}
            <span>
              {formatNumber(item.messageCount, language)} {copy.messages.toLowerCase()} ·{' '}
              {formatNumber(item.participantCount, language)} {copy.participants.toLowerCase()}
            </span>
            <em>{copy.openSaved}</em>
          </button>

          {/* El nombre del chat va en la etiqueta: con diez filas iguales, diez
              botones que digan sólo "Borrar" o "Renombrar" no le sirven a nadie
              que navegue por lector de pantalla. */}
          <button
            type="button"
            className="history-rename"
            onClick={() => onRename(item)}
            aria-label={`${copy.renameSaved}: ${item.chatName}`}
          >
            <PencilIcon />
          </button>

          <button
            type="button"
            className="history-delete"
            onClick={() => onDelete(item)}
            aria-label={`${copy.deleteSaved}: ${item.chatName}`}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
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
