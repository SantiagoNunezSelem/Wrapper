import { useEffect, useMemo, useState } from 'react'
import { AiConsentModal } from '../../components/AiConsentModal'
import { DevToolbar } from '../../components/DevToolbar'
import { FreeUnlockConfirm } from '../../components/FreeUnlockConfirm'
import { LoadingOverlay } from '../../components/LoadingOverlay'
import { LockedPanel } from '../../components/LockedPanel'
import { RecaptchaChallenge } from '../../components/RecaptchaChallenge'
import { RecaptchaNotice } from '../../components/RecaptchaNotice'
import { ResponsiveGoogleLogin } from '../../components/ResponsiveGoogleLogin'
import { SubscriptionPage } from '../../components/SubscriptionPage'
import { VipUnlockPopover } from '../../components/VipUnlockPopover'
import type { Vistazo } from '../../app/useVistazo'
import type { MetricCard } from '../../types'
import { ExportTutorialSheet } from './ExportTutorialSheet'
import { MetricList } from './MetricList'
import { MetricSheet } from './MetricSheet'
import { MobileDrawer } from './MobileDrawer'
import { MobileTabBar, type MobileTab } from './MobileTabBar'
import { MobileAccount, MobileHistory, MobileHome } from './MobileViews'
import { StoryMode } from './StoryMode'
import './mobile.css'

type MobileView = MobileTab

/**
 * Vistazo para teléfono.
 *
 * Consume el mismo `useVistazo()` que `DesktopShell`, así que las métricas, el
 * gate de VIP, la fase de IA y la suscripción son literalmente el mismo código
 * corriendo. Lo único propio de este archivo es el layout y el estado de
 * presentación de abajo: qué pestaña está abierta, si el menú está desplegado y
 * qué métrica se está mirando.
 */
export function MobileShell({ vistazo }: { vistazo: Vistazo }) {
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
    handleToggleDevAi,
    handleToggleDevRecaptchaV3,
    handleToggleDevSubscription,
    handleResetDevFreeUnlocks,
    createStoryLink,
    navigateTo,
    goToSubscriptionPage,
    requestUnlock,
    requestUpload,
    openFilePicker,
    handleFileSelection,
    handleGoogleSuccess,
    handleRecaptchaChallengeSuccess,
    handleLogout,
    handleConsentAccept,
    handleCancelSubscription,
    handlePauseSubscription,
    handleResumeSubscription,
    handleRefreshSubscription,
    openSavedAnalysis,
  } = vistazo

  const [view, setView] = useState<MobileView>('home')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [openMetricId, setOpenMetricId] = useState<string | null>(null)
  const [isStoryOpen, setIsStoryOpen] = useState(false)
  /* El detalle se abrió desde el recorrido, no desde la lista. Cambia dos cosas:
     la hoja se monta por encima de la historia (que queda congelada abajo en su
     misma pantalla) y pierde el paso a la métrica siguiente. */
  const [isDetailOverStory, setIsDetailOverStory] = useState(false)

  /* Terminar de analizar un chat lleva sola a las métricas: el usuario acaba de
     subir el archivo justamente para verlas, hacerle tocar una pestaña sería
     pedirle que confirme lo que ya pidió. */
  useEffect(() => {
    if (analysis) {
      setView('metrics')
    }
  }, [analysis])

  /* Si el chat se descarta (volver al inicio, cerrar sesión), la pestaña de
     métricas se queda sin contenido — hay que salir de ahí. */
  useEffect(() => {
    if (!analysis && view === 'metrics') {
      setView('home')
    }
  }, [analysis, view])

  const openMetricIndex = useMemo(
    () => (openMetricId === null ? -1 : interleavedMetrics.findIndex((card) => card.id === openMetricId)),
    [openMetricId, interleavedMetrics],
  )
  const openMetric = openMetricIndex >= 0 ? interleavedMetrics[openMetricIndex] : null

  function goTo(next: MobileView) {
    setIsDrawerOpen(false)
    setOpenMetricId(null)
    setIsDetailOverStory(false)
    setIsStoryOpen(false)
    setView(next)
  }

  /** Cierra el detalle. Si se había abierto desde el recorrido, éste sigue
   * montado abajo y vuelve a correr solo desde donde había quedado. */
  function closeDetail() {
    setOpenMetricId(null)
    setIsDetailOverStory(false)
  }

  const subscriptionLabel =
    copy.subscriptionPage.statuses[user?.subscriptionState as keyof typeof copy.subscriptionPage.statuses] ??
    copy.mobile.account.noSubscription

  return (
    <div className="m-shell">
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".txt,.zip"
        onChange={(event) => {
          void handleFileSelection(event)
        }}
      />

      {/* Sólo en localhost — `showDevTools` se resuelve una vez desde el
          hostname, así que un build de producción nunca lo renderiza. Los dos
          interruptores (IA y VIP simulado) son los mismos que en desktop: sin
          ellos, probar el shell de mobile con Pro exigiría un pago real. */}
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
          onPause={() => {
            void handlePauseSubscription()
          }}
          onResume={() => {
            void handleResumeSubscription()
          }}
          onRefresh={() => {
            void handleRefreshSubscription()
          }}
          onSignIn={() => setIsAuthModalOpen(true)}
        />
      ) : (
        <>
          <header className="m-topbar">
            <button
              type="button"
              className="m-burger"
              onClick={() => setIsDrawerOpen(true)}
              aria-label={copy.mobile.openMenu}
              aria-expanded={isDrawerOpen}
            >
              <i />
              <i />
              <i />
            </button>

            <button type="button" className="m-brand" onClick={() => goTo('home')}>
              <span className="brand-orb" />
              <span className="m-brand-name">{view === 'metrics' && analysis && user ? analysis.chatName : 'Vistazo'}</span>
            </button>

            {user ? (
              <button type="button" className="m-avatar" onClick={() => goTo('account')} aria-label={copy.account}>
                {user.displayName.slice(0, 1).toUpperCase()}
              </button>
            ) : (
              <button type="button" className="m-signin" onClick={() => setIsAuthModalOpen(true)}>
                {copy.login}
              </button>
            )}
          </header>

          {!hasGoogleClientId ? <p className="warning-banner m-banner">{copy.setupWarning}</p> : null}
          {error ? <p className="error-banner m-banner">{error}</p> : null}

          <main className="m-main">
            {view === 'home' ? (
              <MobileHome
                copy={copy}
                saved={savedAnalyses}
                language={language}
                busyMessage={busyMessage}
                onUpload={requestUpload}
                onOpenSaved={openSavedAnalysis}
                onSeeAll={() => goTo('history')}
              />
            ) : null}

            {view === 'metrics' && analysis ? (
              user ? (
                <MetricList
                  analysis={analysis}
                  metrics={interleavedMetrics}
                  copy={copy}
                  language={language}
                  generatedAt={generatedAt}
                  showReprocessHint={showReprocessHint}
                  ai={aiPanel}
                  onOpenMetric={(card: MetricCard) => {
                    setOpenMetricId(card.id)
                    setIsDetailOverStory(false)
                  }}
                  onStartStory={() => setIsStoryOpen(true)}
                />
              ) : (
                <div className="m-locked-results">
                  <p className="eyebrow">{copy.heroCaption}</p>
                  <h1>{copy.metricsTitle}</h1>
                  <LockedPanel
                    tall
                    preview={copy.loginRequiredPreview}
                    unlockLabel={copy.login}
                    onUnlock={() => setIsAuthModalOpen(true)}
                  />
                </div>
              )
            ) : null}

            {view === 'history' ? (
              <MobileHistory
                copy={copy}
                saved={savedAnalyses}
                language={language}
                user={user}
                onOpenSaved={openSavedAnalysis}
                onSignIn={() => setIsAuthModalOpen(true)}
                onUpload={requestUpload}
              />
            ) : null}

            {view === 'account' ? (
              <MobileAccount
                copy={copy}
                language={language}
                user={user}
                subscription={subscription}
                onSignIn={() => setIsAuthModalOpen(true)}
                onManage={goToSubscriptionPage}
                onSignOut={handleLogout}
              />
            ) : null}
          </main>

          <MobileTabBar
            active={view}
            copy={copy.mobile}
            hasAnalysis={Boolean(analysis)}
            onSelect={goTo}
            onUpload={requestUpload}
          />

          <MobileDrawer
            open={isDrawerOpen}
            copy={copy}
            language={language}
            user={user}
            activeTab={view}
            hasAnalysis={Boolean(analysis)}
            subscriptionLabel={subscriptionLabel}
            onClose={() => setIsDrawerOpen(false)}
            onNavigate={goTo}
            onToggleLanguage={() => setLanguage((current) => (current === 'es' ? 'en' : 'es'))}
            onManageSubscription={() => {
              setIsDrawerOpen(false)
              goToSubscriptionPage()
            }}
            onSignIn={() => {
              setIsDrawerOpen(false)
              setIsAuthModalOpen(true)
            }}
            onSignOut={() => {
              setIsDrawerOpen(false)
              handleLogout()
            }}
          />

          {isStoryOpen && analysis ? (
            <StoryMode
              metrics={interleavedMetrics}
              chatName={analysis.chatName}
              copy={copy}
              // El detalle se abre ENCIMA del recorrido, que se queda quieto en
              // su pantalla mientras tanto — cerrarlo devuelve al usuario ahí.
              suspended={isDetailOverStory && openMetric !== null}
              share={{ createLink: createStoryLink }}
              onClose={() => setIsStoryOpen(false)}
              onOpenDetail={(card) => {
                setOpenMetricId(card.id)
                setIsDetailOverStory(true)
              }}
              onUnlock={() => {
                setIsStoryOpen(false)
                requestUnlock()
              }}
            />
          ) : null}

          {openMetric ? (
            <MetricSheet
              card={openMetric}
              index={openMetricIndex}
              total={interleavedMetrics.length}
              copy={copy}
              ai={aiPanel}
              freeUnlock={freeUnlockFor(openMetric)}
              isRevealingFreeUnlock={revealingFreeUnlockId === openMetric.id}
              overStory={isDetailOverStory}
              messages={activeChat?.messages}
              onClose={closeDetail}
              onPrev={() => setOpenMetricId(interleavedMetrics[openMetricIndex - 1]?.id ?? openMetricId)}
              onNext={() => {
                const next = interleavedMetrics[openMetricIndex + 1]
                setOpenMetricId(next ? next.id : null)
              }}
              onUnlock={requestUnlock}
            />
          ) : null}
        </>
      )}

      {isAuthModalOpen ? (
        <div className="m-layer">
          <button type="button" className="m-scrim" onClick={() => setIsAuthModalOpen(false)} aria-label={copy.close} />
          <section className="m-sheet is-short">
            <span className="m-grabber" aria-hidden="true" />
            <header className="m-sheet-head">
              <div className="m-sheet-title">
                <h2>{needsRecaptchaChallenge ? copy.recaptchaChallengeTitle : copy.loginHeadline}</h2>
                <p>{needsRecaptchaChallenge ? copy.recaptchaChallengeBody : analysis ? copy.loginAfterUpload : copy.saveInfo}</p>
              </div>
              <button type="button" className="m-sheet-close" onClick={() => setIsAuthModalOpen(false)} aria-label={copy.close}>
                ✕
              </button>
            </header>
            <div className="m-sheet-body m-center">
              {needsRecaptchaChallenge ? (
                <RecaptchaChallenge
                  siteKey={recaptchaSiteKeyV2}
                  onSolved={(token) => {
                    void handleRecaptchaChallengeSuccess(token)
                  }}
                />
              ) : hasGoogleClientId ? (
                <ResponsiveGoogleLogin
                  onSuccess={(credentialResponse) => {
                    void handleGoogleSuccess(credentialResponse)
                  }}
                  onError={() => setError(copy.loadError)}
                />
              ) : null}
              {recaptchaSiteKeyV3 ? <RecaptchaNotice language={language} /> : null}
            </div>
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
        />
      ) : null}

      {/* Fuera del bloque de la ruta `app`, como el resto de las capas: la hoja de
          la métrica que lo abrió sigue montada abajo y esto tiene que quedar encima. */}
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
        <ExportTutorialSheet
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
