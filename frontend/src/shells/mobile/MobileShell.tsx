import { useEffect, useMemo, useState } from 'react'
import { AiConsentModal } from '../../components/AiConsentModal'
import { DevToolbar } from '../../components/DevToolbar'
import { LoadingOverlay } from '../../components/LoadingOverlay'
import { ResponsiveGoogleLogin } from '../../components/ResponsiveGoogleLogin'
import { SubscriptionPage } from '../../components/SubscriptionPage'
import { VipUnlockPopover } from '../../components/VipUnlockPopover'
import type { Vistazo } from '../../app/useVistazo'
import type { MetricCard } from '../../types'
import { MetricList } from './MetricList'
import { MetricSheet } from './MetricSheet'
import { MobileDrawer } from './MobileDrawer'
import { MobileTabBar, type MobileTab } from './MobileTabBar'
import { MobileAccount, MobileHistory, MobileHome, MobileUpload } from './MobileViews'
import { StoryMode } from './StoryMode'
import './mobile.css'

/** Vista interna de una pestaña. `upload` no es una pestaña de la barra —se
 * llega por el botón `+`— pero ocupa la pantalla igual que las otras. */
type MobileView = MobileTab | 'upload'

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
    isVipPopoverOpen,
    setIsVipPopoverOpen,
    showDevTools,
    devAiDisabled,
    isDevBusy,
    handleToggleDevAi,
    handleToggleDevSubscription,
    navigateTo,
    goToSubscriptionPage,
    openVipPopover,
    requestUnlock,
    openFilePicker,
    handleFileSelection,
    handleGoogleSuccess,
    handleLogout,
    handleConsentAccept,
    handlePurchaseSuccess,
    handleCancelSubscription,
    handleRefreshSubscription,
    openSavedAnalysis,
  } = vistazo

  const [view, setView] = useState<MobileView>('home')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [openMetricId, setOpenMetricId] = useState<string | null>(null)
  const [isStoryOpen, setIsStoryOpen] = useState(false)

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
    setIsStoryOpen(false)
    setView(next)
  }

  function handleUpload() {
    // Con un chat ya cargado el usuario sabe de qué se trata: se le abre el
    // selector directo. Sin nada cargado todavía, primero el instructivo de
    // cómo exportar, que es donde la gente se traba.
    if (analysis) {
      openFilePicker()
    } else {
      goTo('upload')
    }
  }

  const subscriptionLabel =
    copy.subscriptionPage.statuses[user?.subscriptionState as keyof typeof copy.subscriptionPage.statuses] ??
    copy.mobile.account.noSubscription

  if (route === 'subscription') {
    return (
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
    )
  }

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
          isBusy={isDevBusy}
          onToggleAi={handleToggleDevAi}
          onToggleVip={() => {
            void handleToggleDevSubscription()
          }}
        />
      ) : null}

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
          <span className="m-brand-name">{view === 'metrics' && analysis ? analysis.chatName : 'Vistazo'}</span>
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
            onUpload={handleUpload}
            onOpenSaved={openSavedAnalysis}
            onSeeAll={() => goTo('history')}
          />
        ) : null}

        {view === 'upload' ? <MobileUpload copy={copy} busyMessage={busyMessage} onUpload={openFilePicker} /> : null}

        {view === 'metrics' && analysis ? (
          <MetricList
            analysis={analysis}
            metrics={interleavedMetrics}
            copy={copy}
            language={language}
            generatedAt={generatedAt}
            showReprocessHint={showReprocessHint}
            ai={aiPanel}
            onOpenMetric={(card: MetricCard) => setOpenMetricId(card.id)}
            onStartStory={() => setIsStoryOpen(true)}
          />
        ) : null}

        {view === 'history' ? (
          <MobileHistory
            copy={copy}
            saved={savedAnalyses}
            language={language}
            user={user}
            onOpenSaved={openSavedAnalysis}
            onSignIn={() => setIsAuthModalOpen(true)}
            onUpload={handleUpload}
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
        active={view === 'upload' ? 'home' : view}
        copy={copy.mobile}
        hasAnalysis={Boolean(analysis)}
        onSelect={goTo}
        onUpload={handleUpload}
      />

      <MobileDrawer
        open={isDrawerOpen}
        copy={copy}
        language={language}
        user={user}
        activeTab={view === 'upload' ? 'home' : view}
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
          onClose={() => setIsStoryOpen(false)}
          onOpenDetail={(card) => {
            // Salir del recorrido al abrir el detalle: volver después a la
            // misma pantalla del recorrido sería una pila de dos capas sobre
            // una pantalla de 6 pulgadas.
            setIsStoryOpen(false)
            setOpenMetricId(card.id)
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
          onClose={() => setOpenMetricId(null)}
          onPrev={() => setOpenMetricId(interleavedMetrics[openMetricIndex - 1]?.id ?? openMetricId)}
          onNext={() => {
            const next = interleavedMetrics[openMetricIndex + 1]
            setOpenMetricId(next ? next.id : null)
          }}
          onUnlock={requestUnlock}
        />
      ) : null}

      {isAuthModalOpen ? (
        <div className="m-layer">
          <button type="button" className="m-scrim" onClick={() => setIsAuthModalOpen(false)} aria-label={copy.close} />
          <section className="m-sheet is-short">
            <span className="m-grabber" aria-hidden="true" />
            <header className="m-sheet-head">
              <div className="m-sheet-title">
                <h2>{copy.loginHeadline}</h2>
                <p>{analysis ? copy.loginAfterUpload : copy.saveInfo}</p>
              </div>
              <button type="button" className="m-sheet-close" onClick={() => setIsAuthModalOpen(false)} aria-label={copy.close}>
                ✕
              </button>
            </header>
            <div className="m-sheet-body m-center">
              {hasGoogleClientId ? (
                <ResponsiveGoogleLogin
                  onSuccess={(credentialResponse) => {
                    void handleGoogleSuccess(credentialResponse)
                  }}
                  onError={() => setError(copy.loadError)}
                />
              ) : null}
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
          onSuccess={(overview) => {
            void handlePurchaseSuccess(overview)
          }}
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
