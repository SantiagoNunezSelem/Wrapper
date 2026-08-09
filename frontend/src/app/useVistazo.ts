import { type CredentialResponse } from '@react-oauth/google'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { AiPanelProps } from '../components/AiStatePanel'
import { shellCopy } from '../copy/shellCopy'
import { toAcceptedMessageIds, type AiCandidateSet } from '../lib/aiCandidates'
import { analyzeInWorker, applyAiVerdictsInWorker, buildAiCandidatesInWorker } from '../lib/analysisClient'
import {
  analyzeAiMetrics,
  ApiError,
  cancelSubscription,
  getCurrentUser,
  getSubscription,
  grantAiConsent,
  listAnalyses,
  loginWithGoogle,
  retryAiMetrics,
  saveAnalysis,
  syncSubscription,
  toggleDevSubscription,
} from '../lib/api'
import { isAiDisabled as readAiDisabled, isLocalhost, setAiDisabled } from '../lib/devFlags'
import { getLandingPreviewCards } from '../lib/landingPreview'
import {
  aiMetricIds,
  gateAnalysis,
  isAiMetricId,
  type AiCardStates,
  type AiMetricId,
  type AnalysisCore,
} from '../lib/metrics'
import { parseChatFile } from '../lib/parser'
import type {
  AiMetricStatus,
  AnalysisBundle,
  ChatMessage,
  Language,
  MetricCard as MetricCardData,
  SavedAnalysis,
  SubscriptionOverview,
  UserProfile,
} from '../types'

const authTokenKey = 'wrapper-crm-auth-token'

export interface ActiveChat {
  chatName: string
  messages: ChatMessage[]
  sourceHash: string
}

/**
 * El cerebro de Vistazo: sesión, análisis, IA, suscripción y ruteo.
 *
 * Los dos shells (desktop y mobile) consumen este mismo hook, así que la
 * funcionalidad no puede divergir entre ellos — no está duplicada en ningún
 * lado, hay una sola implementación.
 *
 * Lo que NO vive acá es el estado de presentación: los reveals de scroll, el
 * tilt del mockup 3D o el dropdown de cuenta son formas que sólo tienen
 * sentido en un monitor. Cada shell se guarda las suyas.
 */
export function useVistazo() {
  const [language, setLanguage] = useState<Language>(
    navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en',
  )
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem(authTokenKey))
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([])
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  // Two sources for what's on screen: a live upload (kept as an ungated core so VIP
  // and AI state can be re-applied for free) and a bundle replayed from history.
  const [core, setCore] = useState<AnalysisCore | null>(null)
  const [replayedAnalysis, setReplayedAnalysis] = useState<AnalysisBundle | null>(null)
  const [isReplay, setIsReplay] = useState(false)
  const [pendingPersist, setPendingPersist] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string>('')
  // Non-null only while the worker is computing a chat's metrics — the one busy
  // state with real per-step progress to show. Every other busy state (upload
  // parsing, saving, login, the AI pass) leaves this null, which is what keeps
  // LoadingOverlay on its plain ring spinner for those.
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null)
  const [error, setError] = useState<string>('')
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isExportTutorialOpen, setIsExportTutorialOpen] = useState(false)
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null)
  const [aiStates, setAiStates] = useState<AiCardStates>({})
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false)

  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [subscriptionAction, setSubscriptionAction] = useState<'cancel' | 'refresh' | null>(null)
  const [subscriptionError, setSubscriptionError] = useState('')
  // The "Desbloquear VIP" popover — plan info and the Card Payment Brick, inline, no
  // navigation. Separate from `route`, which only ever points at the full account page.
  const [isVipPopoverOpen, setIsVipPopoverOpen] = useState(false)

  // Minimal client-side router: the subscription screen is its own full-page route
  // (`/suscripcion`), not a modal — everything else in the app still lives at `/`. Two
  // routes don't justify pulling in a router library.
  const [route, setRoute] = useState<'app' | 'subscription'>(() =>
    window.location.pathname === '/suscripcion' ? 'subscription' : 'app',
  )

  // Dev-only switches. `showDevTools` is resolved once from the hostname so a production
  // build never even renders the toolbar.
  const showDevTools = useMemo(() => isLocalhost(), [])
  const [devAiDisabled, setDevAiDisabled] = useState(() => readAiDisabled())
  const [isDevBusy, setIsDevBusy] = useState(false)

  const copy = shellCopy[language]
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // The expensive part of analysis (every metric, computed in a Web Worker) never
  // depends on VIP status — only which fields get exposed does (see gateAnalysis).
  // Caching one core per (sourceHash, language) means unlocking VIP after login is
  // a synchronous re-gate, not a second multi-second recompute.
  const analysisCoreCache = useRef<Map<string, AnalysisCore>>(new Map())

  // Snippets are derived from the messages, not from VIP state, so one build per chat
  // serves the first analysis and every later retry.
  const aiCandidateCache = useRef<Map<string, AiCandidateSet[]>>(new Map())
  // Which (chat, language) the AI phase has already been attempted for, so the effect
  // doesn't re-fire when applying the verdicts changes `core`.
  const aiAttemptedFor = useRef<string>('')
  // The consent modal opens by itself once per session, not on every upload.
  const consentPrompted = useRef(false)

  const hasVipAccess = Boolean(user?.hasVipAccess)

  // What each AI-backed card should say. A viewer without Pro gets an empty map, which
  // the gate reads as "no verdict" and renders as the ordinary VIP lock. A Pro viewer
  // gets the real reason instead: no key on this server, consent not given yet, or
  // whatever the backend last recorded for that metric.
  const aiCardStates = useMemo<AiCardStates>(() => {
    if (!hasVipAccess) {
      return {}
    }

    // Local switch off: the cards read as "IA no disponible", which is exactly what they
    // are right now, rather than falling back to the unverified keyword numbers.
    if (devAiDisabled || !user?.aiEnabled) {
      return everyAiMetric('unavailable')
    }

    if (!user.hasAiConsent) {
      return everyAiMetric('consent')
    }

    return aiStates
  }, [hasVipAccess, devAiDisabled, user?.aiEnabled, user?.hasAiConsent, aiStates])

  // Either a live upload (gated on the fly, so VIP or an AI verdict landing mid-session
  // costs nothing to reflect) or a bundle replayed from history exactly as it was saved.
  const analysis = useMemo(
    () => replayedAnalysis ?? (core ? gateAnalysis(core, hasVipAccess, aiCardStates) : null),
    [replayedAnalysis, core, hasVipAccess, aiCardStates],
  )

  useEffect(() => {
    if (!token) {
      return
    }

    void hydrateSession(token)
  }, [token])

  // Keeps `route` in sync with the back/forward buttons — pushState alone only updates
  // the address bar, not this state.
  useEffect(() => {
    function handlePopState() {
      setRoute(window.location.pathname === '/suscripcion' ? 'subscription' : 'app')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigateTo(path: string) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setRoute(path === '/suscripcion' ? 'subscription' : 'app')
  }

  // Recompute locally whenever the underlying chat or language changes. VIP
  // entitlement is deliberately *not* a dependency: gating happens downstream in
  // `gateAnalysis`, so unlocking VIP re-gates an already-computed core still held in
  // memory — never a server round trip, and (see cache above) almost never a second
  // worker computation either.
  useEffect(() => {
    if (!activeChat) {
      return
    }

    const cacheKey = `${activeChat.sourceHash}:${language}`
    const cached = analysisCoreCache.current.get(cacheKey)

    if (cached) {
      setBusyMessage('')
      setAnalysisProgress(null)
      setCore(cached)
      return
    }

    // Guard against setting stale results if activeChat or language changes again
    // before the worker responds.
    let cancelled = false
    let settled = false
    setBusyMessage(copy.analyzing)
    setAnalysisProgress(0)

    analyzeInWorker(activeChat.chatName, activeChat.messages, language, activeChat.sourceHash, (completed, total) => {
      if (!cancelled) {
        setAnalysisProgress(completed / total)
      }
    })
      .then((computed) => {
        if (cancelled) {
          return
        }
        analysisCoreCache.current.set(cacheKey, computed)
        setCore(computed)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }
        console.error(caught)
        setError(caught instanceof Error ? caught.message : copy.loadError)
      })
      .finally(() => {
        settled = true
        if (!cancelled) {
          setBusyMessage('')
          setAnalysisProgress(null)
        }
      })

    return () => {
      cancelled = true
      // The worker never got to its own .finally() (e.g. the user navigated away
      // mid-analysis), so it will never clear the overlay it opened — do it here
      // instead of leaving busyMessage/analysisProgress stuck. If the call had
      // already settled, a later effect (AI phase, saving, ...) may own busyMessage
      // by now, so leave it alone.
      if (!settled) {
        setBusyMessage('')
        setAnalysisProgress(null)
      }
    }
  }, [activeChat, language])

  // The AI pass is kept out of the analysis above on purpose: it is the only part of
  // this app that costs money, so it runs exactly when it can produce something the
  // viewer will actually see — Pro access, a key configured on the server, consent
  // given, and the chat still in memory to build the snippets from. A free user never
  // reaches this effect, which is what keeps their upload from spending a single token.
  useEffect(() => {
    if (!activeChat || !core || !token) {
      return
    }

    // The local kill switch is checked here, before anything is built or sent: importing
    // a chat with it on must cost exactly zero tokens.
    if (devAiDisabled) {
      return
    }

    if (!user?.hasVipAccess || !user.aiEnabled || !user.hasAiConsent) {
      return
    }

    const runKey = `${activeChat.sourceHash}:${language}`
    if (aiAttemptedFor.current === runKey) {
      return
    }

    aiAttemptedFor.current = runKey
    void runAiPhase(token, activeChat, core, { retry: false })
  }, [activeChat, core, token, language, devAiDisabled, user?.hasVipAccess, user?.aiEnabled, user?.hasAiConsent])

  // Asked once per session, and only where it's actionable: a Pro viewer looking at a
  // chat whose spicy/red-flag cards are waiting on exactly this permission.
  useEffect(() => {
    if (consentPrompted.current || !core || devAiDisabled) {
      return
    }

    if (!user?.hasVipAccess || !user.aiEnabled || user.hasAiConsent) {
      return
    }

    consentPrompted.current = true
    setIsConsentModalOpen(true)
  }, [core, devAiDisabled, user?.hasVipAccess, user?.aiEnabled, user?.hasAiConsent])

  useEffect(() => {
    if (!pendingPersist || !analysis) {
      return
    }

    setPendingPersist(false)

    if (token) {
      void persistAnalysis(token, analysis)
    } else {
      setIsAuthModalOpen(true)
    }
  }, [pendingPersist, analysis, token])

  // Localhost only: the VIP switch has to know which way it is currently pointing, and
  // that lives in the subscription overview. One extra call, never in production.
  useEffect(() => {
    if (!showDevTools || !token) {
      return
    }

    void loadSubscription(token)
  }, [showDevTools, token])

  async function hydrateSession(authToken: string) {
    try {
      const [currentUser, analyses] = await Promise.all([
        getCurrentUser(authToken),
        listAnalyses(authToken),
      ])

      setUser(currentUser)
      setSavedAnalyses(analyses)
    } catch (caught) {
      console.error(caught)
      localStorage.removeItem(authTokenKey)
      setToken(null)
      setUser(null)
    }
  }

  /** Loads the account screen's data. Kept separate from `hydrateSession` so signing in
   * does not pay for a subscription round trip nobody asked to see yet. */
  async function loadSubscription(authToken: string) {
    try {
      setSubscription(await getSubscription(authToken))
    } catch (caught) {
      console.error(caught)
      setSubscriptionError(caught instanceof Error ? caught.message : copy.loadError)
    }
  }

  function goToSubscriptionPage() {
    setSubscriptionError('')
    navigateTo('/suscripcion')

    if (token) {
      void loadSubscription(token)
    }
  }

  /** "Desbloquear VIP" on a locked card: a quick popover, not a page — see
   * VipUnlockPopover. Loads the plan/eligibility data it needs if signed in. */
  function openVipPopover() {
    setSubscriptionError('')
    setIsVipPopoverOpen(true)

    if (token) {
      void loadSubscription(token)
    }
  }

  /** Shared by both purchase surfaces (the popover and the full account page): the
   * Brick already finished and Mercado Pago already authorized the subscription by the
   * time this runs, so it is just reconciling local state with what the backend
   * returned — never a second network attempt at the purchase itself. */
  async function handlePurchaseSuccess(overview: SubscriptionOverview) {
    setSubscription(overview)

    if (token) {
      try {
        setUser(await getCurrentUser(token))
      } catch (caught) {
        console.error(caught)
      }
    }
  }

  async function handleCancelSubscription() {
    if (!token) {
      return
    }

    setSubscriptionError('')
    setSubscriptionAction('cancel')

    try {
      setSubscription(await cancelSubscription(token))
      setUser(await getCurrentUser(token))
    } catch (caught) {
      console.error(caught)
      setSubscriptionError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setSubscriptionAction(null)
    }
  }

  async function handleRefreshSubscription() {
    if (!token) {
      return
    }

    setSubscriptionError('')
    setSubscriptionAction('refresh')

    try {
      setSubscription(await syncSubscription(token))
      setUser(await getCurrentUser(token))
    } catch (caught) {
      console.error(caught)
      setSubscriptionError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setSubscriptionAction(null)
    }
  }

  function handleToggleDevAi() {
    setDevAiDisabled((current) => {
      const next = !current
      setAiDisabled(next)

      if (next) {
        // Drop any verdicts already on screen so the cards match the switch instead of
        // showing results from before it was flipped.
        setAiStates({})
      }

      aiAttemptedFor.current = ''
      return next
    })
  }

  async function handleToggleDevSubscription() {
    if (!token) {
      return
    }

    setIsDevBusy(true)

    try {
      await toggleDevSubscription(token)
      // Re-read rather than assume: the toggle's effect on access is the backend's call.
      // Both requests matter here, not just when the modal happens to be open — the
      // toolbar button's own on/off color reads `subscription.current`, not `user`, so
      // skipping this left the button looking frozen after a successful toggle.
      const [nextUser] = await Promise.all([getCurrentUser(token), loadSubscription(token)])
      setUser(nextUser)
    } catch (caught) {
      console.error(caught)
      setError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setIsDevBusy(false)
    }
  }

  async function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      setError(copy.loadError)
      return
    }

    setError('')
    // The modal's own job is done once we have a credential — close it and hand
    // off to the full-screen overlay so there's a clear "still working" signal
    // for however long sign-in (and, if a chat is loaded, re-gating it) takes.
    setIsAuthModalOpen(false)
    setBusyMessage(copy.loggingIn)

    try {
      const auth = await loginWithGoogle(response.credential)
      localStorage.setItem(authTokenKey, auth.token)
      setToken(auth.token)
      setUser(auth.user)
      setSavedAnalyses(await listAnalyses(auth.token))

      if (activeChat) {
        // The recompute effect will refresh `analysis` for the new VIP state;
        // this flag lets the persist effect pick up that fresh value.
        setPendingPersist(true)
      }
    } catch (caught) {
      console.error(caught)
      setError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setBusyMessage('')
    }
  }

  function handleLogout() {
    localStorage.removeItem(authTokenKey)
    setToken(null)
    setUser(null)
    setSavedAnalyses([])
    setError('')
    setAiStates({})
    setSubscription(null)
    setSubscriptionError('')
    setIsVipPopoverOpen(false)
    aiAttemptedFor.current = ''
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  /** "Subir archivo" en un contexto de primera vez: muestra el tutorial de
      exportación antes que nada, salvo que ya haya un análisis cargado —
      ahí el usuario ya sabe de qué se trata. */
  function requestUpload() {
    if (analysis) {
      openFilePicker()
    } else {
      setIsExportTutorialOpen(true)
    }
  }

  /** "Desbloquear VIP" on a locked card: opens the quick popover — see openVipPopover. */
  function requestUnlock() {
    openVipPopover()
  }

  async function processFile(file: File) {
    setError('')
    setBusyMessage(copy.processing)

    try {
      const { messages, sourceHash } = await parseChatFile(file)
      setIsReplay(false)
      setReplayedAnalysis(null)
      // Per-chat state: cleared here, then rebuilt by the AI effect (which will read
      // the backend's stored verdicts for free if this chat was analyzed before).
      setAiStates({})
      aiAttemptedFor.current = ''
      setActiveChat({ chatName: stripExtension(file.name), messages, sourceHash })
      setPendingPersist(true)
      setSelectedMetricId(null)
      // Left on: parsing hands off straight into the recompute effect's worker
      // call, which clears it once the analysis is actually ready — otherwise the
      // overlay would flash off between "file parsed" and "analysis starting."
    } catch (caught) {
      console.error(caught)
      setBusyMessage('')
      setError(caught instanceof Error ? caught.message : copy.loadError)
    }
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    await processFile(file)
    event.target.value = ''
  }

  /** Snippets depend only on the messages, so one build per chat serves the first
   * analysis and every later retry. */
  async function getAiCandidates(chat: ActiveChat): Promise<AiCandidateSet[]> {
    const cached = aiCandidateCache.current.get(chat.sourceHash)

    if (cached) {
      return cached
    }

    const built = await buildAiCandidatesInWorker(chat.sourceHash, chat.messages)
    aiCandidateCache.current.set(chat.sourceHash, built)
    return built
  }

  /**
   * Sends the filtered snippets for judging and folds the answer back into the core.
   * Metrics are handled one by one all the way down, so a metric that runs out of
   * quota leaves the others — AI-backed or not — exactly as they were.
   */
  async function runAiPhase(
    authToken: string,
    chat: ActiveChat,
    currentCore: AnalysisCore,
    options: { retry: boolean },
  ) {
    // Toggling the language mid-flight rebuilds the core under a different key. This
    // request's answer belongs to the core it started from, so it's dropped rather
    // than allowed to overwrite a newer one.
    const runKey = `${chat.sourceHash}:${language}`
    const isStale = () => aiAttemptedFor.current !== runKey

    setIsAiBusy(true)
    setBusyMessage(copy.analyzingAi)

    try {
      const candidateSets = await getAiCandidates(chat)

      const results = options.retry
        ? // A retry needs no payload: the backend still holds the snippets from the
          // attempt that failed, and only re-runs the metrics still marked failed.
          await retryAiMetrics(authToken, chat.sourceHash)
        : await analyzeAiMetrics(authToken, {
            sourceHash: chat.sourceHash,
            metrics: candidateSets.map((set) => ({
              metricId: set.metricId,
              snippets: set.candidates.map(({ id, keyword, text }) => ({ id, keyword, text })),
            })),
          })

      const nextStates: AiCardStates = {}
      const verdicts: Partial<Record<AiMetricId, string[]>> = {}

      for (const result of results) {
        if (!isAiMetricId(result.metricId)) {
          continue
        }

        nextStates[result.metricId] = {
          status: result.status,
          errorCode: result.errorCode,
          retryAvailableAtUtc: result.retryAvailableAtUtc,
        }

        if (result.status === 'ready') {
          const set = candidateSets.find((candidate) => candidate.metricId === result.metricId)
          verdicts[result.metricId] = [...toAcceptedMessageIds(set?.candidates ?? [], result.acceptedIds)]
        }
      }

      if (isStale()) {
        return
      }

      setAiStates((current) => ({ ...current, ...nextStates }))

      if (Object.keys(verdicts).length > 0) {
        const enriched = await applyAiVerdictsInWorker(
          currentCore,
          chat.sourceHash,
          language,
          chat.messages,
          verdicts,
        )

        if (isStale()) {
          return
        }

        analysisCoreCache.current.set(runKey, enriched)
        setCore(enriched)
        // Store the enriched bundle so reopening this chat from history shows the
        // verified numbers without asking the model anything again.
        setPendingPersist(true)
      }

      setError(results.some((result) => result.status === 'failed') ? copy.aiPartialError : '')
    } catch (caught) {
      console.error(caught)

      if (isStale()) {
        return
      }

      // The request never landed (offline, server down, consent revoked). Mark the AI
      // metrics so they show a way forward — everything else on the page stays up.
      const code = caught instanceof ApiError ? caught.code : undefined
      setAiStates((current) => ({
        ...current,
        ...everyAiMetric(code === 'consent_required' ? 'consent' : 'failed'),
      }))
      setError(copy.aiPartialError)
    } finally {
      setIsAiBusy(false)
      setBusyMessage('')
    }
  }

  function handleAiRetry() {
    if (!token || !activeChat || !core) {
      // Nothing in memory to rebuild the snippets from — ask for the chat instead of
      // firing a retry whose result could never be displayed.
      openFilePicker()
      return
    }

    void runAiPhase(token, activeChat, core, { retry: true })
  }

  async function handleConsentAccept() {
    if (!token) {
      return
    }

    setIsAiBusy(true)

    try {
      setUser(await grantAiConsent(token))
      setIsConsentModalOpen(false)
      // Clear the guard so the AI effect fires for the chat already on screen.
      aiAttemptedFor.current = ''
    } catch (caught) {
      console.error(caught)
      setError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setIsAiBusy(false)
    }
  }

  async function persistAnalysis(authToken: string, builtAnalysis: AnalysisBundle) {
    setBusyMessage(copy.saving)

    try {
      const saved = await saveAnalysis(authToken, {
        chatName: builtAnalysis.chatName,
        dateRangeLabel: builtAnalysis.dateRangeLabel,
        messageCount: builtAnalysis.messageCount,
        participantCount: builtAnalysis.participantCount,
        resultsJson: JSON.stringify(builtAnalysis),
        sourceHash: builtAnalysis.sourceHash,
      })

      setSavedAnalyses((current) => [saved, ...current.filter((item) => item.sourceHash !== saved.sourceHash)])
    } finally {
      setBusyMessage('')
    }
  }

  function openSavedAnalysis(item: SavedAnalysis) {
    setActiveChat(null)
    setCore(null)
    setIsReplay(true)
    setPendingPersist(false)
    // A saved bundle is already gated and already carries whatever AI state it had
    // when it was stored; it is shown as-is, since re-deriving any card would need the
    // raw messages, which never leave the browser and are gone by now.
    setReplayedAnalysis(JSON.parse(item.resultsJson) as AnalysisBundle)
    setSelectedMetricId(null)
  }

  function backToLanding() {
    setCore(null)
    setReplayedAnalysis(null)
    setActiveChat(null)
    setIsReplay(false)
    setSelectedMetricId(null)
  }

  // Only Pro viewers get the AI panel; for everyone else an AI metric is just a locked
  // VIP card and the upsell is the right message.
  const aiPanel: AiPanelProps | undefined = hasVipAccess
    ? {
        copy: copy.ai,
        canRetry: Boolean(activeChat && core),
        isBusy: isAiBusy,
        onRetry: handleAiRetry,
        onConsent: () => setIsConsentModalOpen(true),
      }
    : undefined

  const generatedAt = useMemo(() => {
    if (!analysis) {
      return ''
    }

    return new Intl.DateTimeFormat(language === 'es' ? 'es-AR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(analysis.generatedAt))
  }, [analysis, language])

  const interleavedMetrics = useMemo(() => {
    if (!analysis) {
      return []
    }
    return interleave(analysis.freeMetrics, analysis.vipMetrics)
  }, [analysis])

  const landingPreviewCards = useMemo(() => getLandingPreviewCards(language), [language])

  const selectedMetric = useMemo(
    () => [...interleavedMetrics, ...landingPreviewCards].find((card) => card.id === selectedMetricId) ?? null,
    [interleavedMetrics, landingPreviewCards, selectedMetricId],
  )

  const hasLockedVipCards = analysis ? analysis.vipMetrics.some((card) => !card.basic || !card.detail) : false
  const showReprocessHint = isReplay && Boolean(user?.hasVipAccess) && hasLockedVipCards
  return {
    // --- sesión e idioma ---
    language,
    setLanguage,
    copy,
    user,
    token,
    hasGoogleClientId,

    // --- chat y análisis ---
    activeChat,
    analysis,
    savedAnalyses,
    interleavedMetrics,
    landingPreviewCards,
    selectedMetric,
    selectedMetricId,
    setSelectedMetricId,
    generatedAt,
    showReprocessHint,
    fileInputRef,

    // --- estado transitorio ---
    busyMessage,
    analysisProgress,
    error,
    setError,

    // --- IA ---
    aiPanel,
    isAiBusy,
    isConsentModalOpen,
    setIsConsentModalOpen,

    // --- suscripción y ruteo ---
    route,
    subscription,
    subscriptionAction,
    subscriptionError,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isExportTutorialOpen,
    setIsExportTutorialOpen,
    isVipPopoverOpen,
    setIsVipPopoverOpen,

    // --- sólo en localhost ---
    showDevTools,
    devAiDisabled,
    isDevBusy,

    // --- acciones ---
    navigateTo,
    goToSubscriptionPage,
    openVipPopover,
    requestUnlock,
    requestUpload,
    openFilePicker,
    processFile,
    handleFileSelection,
    handleGoogleSuccess,
    handleLogout,
    handlePurchaseSuccess,
    handleCancelSubscription,
    handleRefreshSubscription,
    handleAiRetry,
    handleConsentAccept,
    handleToggleDevAi,
    handleToggleDevSubscription,
    openSavedAnalysis,
    backToLanding,
  }
}

export type Vistazo = ReturnType<typeof useVistazo>

/** El mismo estado para todas las métricas con IA — para los motivos que
 * aplican a todas a la vez (sin key en el server, sin consentimiento, request
 * que nunca llegó). */
function everyAiMetric(status: AiMetricStatus): AiCardStates {
  return Object.fromEntries(aiMetricIds.map((metricId) => [metricId, { status }])) as AiCardStates
}

function interleave(free: MetricCardData[], vip: MetricCardData[]): MetricCardData[] {
  const result: MetricCardData[] = []
  const max = Math.max(free.length, vip.length)

  for (let index = 0; index < max; index += 1) {
    if (free[index]) {
      result.push(free[index])
    }
    if (vip[index]) {
      result.push(vip[index])
    }
  }

  return result
}

function stripExtension(fileName: string): string {
  const parts = fileName.split('.')
  parts.pop()
  return parts.join('.') || fileName
}
