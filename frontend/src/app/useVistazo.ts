import { type CredentialResponse } from '@react-oauth/google'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { AiPanelProps } from '../components/AiStatePanel'
import type { FreeUnlockPrompt } from '../components/LockedPanel'
import type { SubscriptionBusyAction } from '../components/SubscriptionPage'
import { shellCopy } from '../copy/shellCopy'
import { toAcceptedMessageIds, type AiCandidateSet } from '../lib/aiCandidates'
import { analyzeInWorker, applyAiVerdictsInWorker, buildAiCandidatesInWorker } from '../lib/analysisClient'
import {
  analyzeAiMetrics,
  ApiError,
  cancelSubscription,
  createShare,
  deleteAnalysis,
  getCurrentUser,
  getFreeUnlocks,
  getSubscription,
  grantAiConsent,
  listAnalyses,
  loginWithGoogle,
  pauseSubscription,
  resetDevFreeUnlocks,
  resumeSubscription,
  retryAiMetrics,
  saveAnalysis,
  spendFreeUnlock,
  syncSubscription,
  toggleDevSubscription,
  updatePreferredLanguage,
} from '../lib/api'
import {
  isAiDisabled as readAiDisabled,
  isLocalhost,
  isRecaptchaV3Disabled as readRecaptchaV3Disabled,
  setAiDisabled,
  setRecaptchaV3Disabled,
} from '../lib/devFlags'
import { getLandingPreviewCards } from '../lib/landingPreview'
import { executeRecaptchaV3 } from '../lib/recaptcha'
import {
  aiMetricIds,
  gateAnalysis,
  isAiMetricId,
  type AiCardStates,
  type AiMetricId,
  type AnalysisCore,
} from '../lib/metrics'
import { parseChatFile } from '../lib/parser'
import { buildSharePayload, readShareSlug, shareUrlFor } from '../lib/shareStory'
import { takeSharedFile } from '../lib/shareTargetFile'
import { formatLongWait, useSecondsUntil } from '../lib/useCountdown'
import type {
  AiMetricStatus,
  AnalysisBundle,
  ChatMessage,
  FreeUnlockState,
  Language,
  MetricCard as MetricCardData,
  SavedAnalysis,
  SubscriptionOverview,
  UserProfile,
} from '../types'

const authTokenKey = 'wrapper-crm-auth-token'

/** How many times the account screen re-checks a just-returned checkout before handing
 * the job to the server-side reconciler. Five attempts spans about 90 seconds. */
const checkoutPollAttempts = 5

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
  // El análisis para el que hay una confirmación de borrado abierta. Se guarda el id
  // y la fila se busca por él, así una lista que se refresca no deja el diálogo
  // hablando de algo que ya no está.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isDeletingAnalysis, setIsDeletingAnalysis] = useState(false)
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
  // True once the backend has rejected a login for a low reCAPTCHA v3 score — swaps the
  // Google button in the auth modal for the v2 checkbox fallback.
  const [needsRecaptchaChallenge, setNeedsRecaptchaChallenge] = useState(false)
  // The Google id-token from the attempt that triggered the challenge above, so solving
  // the checkbox can retry login without asking Google for a fresh one.
  const pendingGoogleIdToken = useRef<string | null>(null)
  const [isExportTutorialOpen, setIsExportTutorialOpen] = useState(false)
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null)
  const [aiStates, setAiStates] = useState<AiCardStates>({})
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false)

  // Today's free detail unlocks. Null until the account's allowance has been read (or
  // for a signed-out visitor, who has no account to count against) — which is exactly
  // the state where no free-unlock affordance should be offered at all.
  const [freeUnlocks, setFreeUnlocks] = useState<FreeUnlockState | null>(null)
  // The metric a confirmation is currently open for. The confirm exists because the
  // allowance is small and only refills tomorrow — see FreeUnlockConfirm.
  const [pendingFreeUnlockId, setPendingFreeUnlockId] = useState<string | null>(null)
  // The metric currently showing the post-confirm loading spinner in its own detail
  // panel — see confirmFreeUnlock. At most one at a time: it tracks the confirm flow,
  // and a user can only have one confirm open at once.
  const [revealingFreeUnlockId, setRevealingFreeUnlockId] = useState<string | null>(null)

  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [subscriptionAction, setSubscriptionAction] = useState<SubscriptionBusyAction | null>(null)
  const [subscriptionError, setSubscriptionError] = useState('')
  // Re-checks left after landing back from Mercado Pago. Counted down rather than run on
  // an interval so the polling is bounded: a payment that has not settled in a minute is
  // not going to settle while someone stares at it, and the background reconciler owns it
  // from there.
  const [checkoutPollsLeft, setCheckoutPollsLeft] = useState(0)
  // The "Desbloquear VIP" popover — plan info and the Card Payment Brick, inline, no
  // navigation. Separate from `route`, which only ever points at the full account page.
  const [isVipPopoverOpen, setIsVipPopoverOpen] = useState(false)

  // Minimal client-side router: the subscription screen is its own full-page route
  // (`/suscripcion`), not a modal — everything else in the app still lives at `/`. Two
  // routes don't justify pulling in a router library.
  const [route, setRoute] = useState<'app' | 'subscription'>(() =>
    window.location.pathname === '/suscripcion' ? 'subscription' : 'app',
  )

  // A shared story (`/s/{slug}`) is read once, at load, and never changes for the life of
  // the tab: it is a public page someone opened from a link, not somewhere the app
  // navigates to. Kept out of `route` for that reason — that state is about which screen
  // of the app is showing, and this is the case where the app is not showing at all.
  const shareSlug = useMemo(() => readShareSlug(window.location.pathname), [])

  // Dev-only switches. `showDevTools` is resolved once from the hostname so a production
  // build never even renders the toolbar.
  const showDevTools = useMemo(() => isLocalhost(), [])
  const [devAiDisabled, setDevAiDisabled] = useState(() => readAiDisabled())
  const [devRecaptchaV3Disabled, setDevRecaptchaV3Disabled] = useState(() => readRecaptchaV3Disabled())
  const [isDevBusy, setIsDevBusy] = useState(false)

  const copy = shellCopy[language]
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  const recaptchaSiteKeyV3 = import.meta.env.VITE_RECAPTCHA_SITE_KEY_V3 ?? ''
  const recaptchaSiteKeyV2 = import.meta.env.VITE_RECAPTCHA_SITE_KEY_V2 ?? ''
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

  // Ticks down to the server's own reset instant, so "vuelven en 4h 12m" keeps counting
  // without another round trip — and hits zero at the same moment for every device.
  const secondsUntilFreeUnlockReset = useSecondsUntil(freeUnlocks?.resetsAtUtc)

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

  // Only the unlocks bought for the chat currently on screen. The hash check is what
  // keeps an answer that lands after the user has already switched chats from opening a
  // detail on the new one that nobody paid for.
  const freeUnlockedIds = useMemo(() => {
    if (!freeUnlocks || !activeChat || freeUnlocks.sourceHash !== activeChat.sourceHash) {
      return new Set<string>()
    }

    return new Set(freeUnlocks.unlockedMetricIds)
  }, [freeUnlocks, activeChat])

  // Either a live upload (gated on the fly, so VIP, an AI verdict or a free unlock
  // landing mid-session costs nothing to reflect) or a bundle replayed from history
  // exactly as it was saved.
  const analysis = useMemo(
    () => replayedAnalysis ?? (core ? gateAnalysis(core, hasVipAccess, aiCardStates, freeUnlockedIds) : null),
    [replayedAnalysis, core, hasVipAccess, aiCardStates, freeUnlockedIds],
  )

  useEffect(() => {
    if (!token) {
      return
    }

    void hydrateSession(token)
  }, [token])

  // El idioma del documento tiene que seguir al de la interfaz: con `lang="en"` fijo,
  // un lector de pantalla leía todo el español con voz inglesa y el navegador ofrecía
  // traducir una página que ya estaba en el idioma del usuario.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // Keeps `route` in sync with the back/forward buttons — pushState alone only updates
  // the address bar, not this state.
  useEffect(() => {
    function handlePopState() {
      setRoute(window.location.pathname === '/suscripcion' ? 'subscription' : 'app')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // El manifest declara `share_target`: cuando alguien comparte un archivo desde otra
  // app (por ejemplo, "Exportar chat" en WhatsApp) con Vistazo ya instalada, `sw.js`
  // intercepta esa navegación, guarda el archivo en IndexedDB y redirige acá con esta
  // marca — así entra por el mismo camino que una carga manual, con toda la UI de
  // progreso y errores ya resuelta.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('share-target') !== '1') {
      return
    }

    params.delete('share-target')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)

    void takeSharedFile().then(({ file, debug }) => {
      // Puesto directo en el mensaje de error (no sólo en consola): sin cable ni PC a
      // mano, esto es lo único que deja ver qué llegó realmente en el POST del share.
      const debugSuffix = debug ? ` [debug: ${JSON.stringify(debug)}]` : ''

      if (debug) {
        console.info('[share-target]', debug)
      }

      if (file) {
        void processFile(file, debugSuffix)
      } else {
        setError(`${copy.shareTargetError}${debugSuffix}`)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Read once the account is known and only while it lacks Pro: with Pro every detail is
  // already open, so the allowance is dead weight. It is re-read whenever `hasVipAccess`
  // flips, which is what makes a lapsed subscription fall back to the free unlocks
  // without a reload — and whenever the chat changes, since which metrics are unlocked
  // is a property of the chat, not of the account.
  useEffect(() => {
    if (!token || !user || hasVipAccess) {
      setFreeUnlocks(null)
      return
    }

    void loadFreeUnlocks(token, activeChat?.sourceHash)
    // Keyed on identity, entitlement and chat, not on the whole `user`/`activeChat`:
    // every unrelated refresh of those objects would otherwise re-fetch the same
    // allowance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, hasVipAccess, activeChat?.sourceHash])

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

      // Sólo un rechazo de identidad invalida la sesión. Un backend caído, un wifi que
      // se cortó o un CORS mal configurado son transitorios: borrar el token ahí
      // deslogueaba al usuario y le vaciaba el historial por un parpadeo de red, y al
      // volver la conexión ya no había forma de recuperarlo sin volver a entrar.
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        localStorage.removeItem(authTokenKey)
        setToken(null)
        setUser(null)
      }
    }
  }

  // The account's saved language wins over whatever was showing before login (browser
  // default, or a choice made while browsing anonymously): this is what makes a reload
  // or a login on another device come back with the language the user last picked.
  useEffect(() => {
    if (user) {
      setLanguage(user.preferredLanguage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.preferredLanguage])

  // The mirror direction: once logged in, toggling the language persists it to the
  // account instead of only living in this tab. Guarded by the equality check so the
  // sync above (server -> UI) never bounces back into a network call.
  useEffect(() => {
    if (!token || !user || language === user.preferredLanguage) {
      return
    }

    updatePreferredLanguage(token, language)
      .then(setUser)
      .catch((caught) => console.error(caught))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Midnight passed with the tab still open. Re-read rather than refill locally: the day
  // key is the server's, and guessing it here is how a UI ends up offering five unlocks
  // the backend will refuse.
  useEffect(() => {
    if (!token || !freeUnlocks || secondsUntilFreeUnlockReset > 0) {
      return
    }

    void loadFreeUnlocks(token, activeChat?.sourceHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, secondsUntilFreeUnlockReset, freeUnlocks?.resetsAtUtc])

  /** Never surfaced as an error: failing to read the allowance just means no free-unlock
   * button this session, and the ordinary VIP upsell is still a working way forward. */
  async function loadFreeUnlocks(authToken: string, sourceHash?: string) {
    try {
      setFreeUnlocks(await getFreeUnlocks(authToken, sourceHash))
    } catch (caught) {
      console.error(caught)
      setFreeUnlocks(null)
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
    // Loading is handled by the effect below, keyed on `route` — it also covers landing
    // here straight from a fresh page load (typed URL, bookmark, back from Mercado Pago).
  }

  /** "Desbloquear VIP" on a locked card: a quick popover, not a page — see
   * VipUnlockPopover. Loads the plan/eligibility data it needs if signed in.
   *
   * Envuelto en useCallback porque baja como prop a las 25 tarjetas: si cambiara
   * de identidad en cada render, el memo de MetricCard/MetricRow no serviría de
   * nada y cualquier cambio de estado del shell volvería a dibujar los 25
   * gráficos. */
  const openVipPopover = useCallback(
    () => {
      setSubscriptionError('')
      setIsVipPopoverOpen(true)

      if (token) {
        void loadSubscription(token)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  )

  // Keeps the account screen's data fresh whenever it becomes the active route — a click
  // from inside the app (goToSubscriptionPage above never fetches itself), a page load
  // straight at `/suscripcion`, or the browser's back/forward buttons. The `checkout`
  // query param is Mercado Pago's own back_url marker (see MercadoPagoOptions.BackUrl):
  // the browser almost always gets back before their webhook does, so this is what makes
  // "you're on the free trial now" show up immediately instead of a stale "pendiente".
  useEffect(() => {
    if (!token || route !== 'subscription') {
      return
    }

    const params = new URLSearchParams(window.location.search)

    if (params.get('checkout') === 'return') {
      params.delete('checkout')
      const query = params.toString()
      window.history.replaceState({}, '', `/suscripcion${query ? `?${query}` : ''}`)
      // Arms the bounded re-check below, for the common case where Mercado Pago has not
      // finished processing by the time the browser is back.
      setCheckoutPollsLeft(checkoutPollAttempts)
      void handleRefreshSubscription()
    } else {
      void loadSubscription(token)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, route])

  /**
   * Cancel, pause, resume and refresh differ only in which call they make: each one
   * answers with the whole refreshed overview, and each one can change whether this
   * account still has Pro, so the user profile is re-read afterwards too. Written once so
   * a new action cannot forget the profile refresh and leave the rest of the app showing
   * VIP cards the server no longer unlocks.
   */
  async function runSubscriptionAction(
    action: SubscriptionBusyAction,
    call: (authToken: string) => Promise<SubscriptionOverview>,
  ) {
    if (!token) {
      return
    }

    setSubscriptionError('')
    setSubscriptionAction(action)

    try {
      setSubscription(await call(token))
      setUser(await getCurrentUser(token))
    } catch (caught) {
      console.error(caught)
      setSubscriptionError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setSubscriptionAction(null)
    }
  }

  function handleCancelSubscription() {
    return runSubscriptionAction('cancel', cancelSubscription)
  }

  function handlePauseSubscription() {
    return runSubscriptionAction('pause', pauseSubscription)
  }

  function handleResumeSubscription() {
    return runSubscriptionAction('resume', resumeSubscription)
  }

  function handleRefreshSubscription() {
    return runSubscriptionAction('refresh', syncSubscription)
  }

  // Coming back from Mercado Pago, the payment is often not settled yet: the browser
  // beats the webhook, and their own processing can take another few seconds. Without
  // this the customer lands on "pendiente" right after paying, which reads as "it did not
  // work" — so the screen keeps asking, a few times, with growing gaps, and stops as soon
  // as the answer changes. The background reconciler covers everything slower than this;
  // this is only about the first minute, when someone is still watching.
  useEffect(() => {
    if (route !== 'subscription' || !token || checkoutPollsLeft <= 0) {
      return
    }

    if (subscription?.current?.status !== 'pendiente') {
      // Settled (or there is nothing to settle) — stop asking.
      setCheckoutPollsLeft(0)
      return
    }

    const attempt = checkoutPollAttempts - checkoutPollsLeft
    const timer = window.setTimeout(
      () => {
        setCheckoutPollsLeft((left) => left - 1)
        void handleRefreshSubscription()
      },
      // 3s, 6s, 12s, 24s, 48s: long enough to be worth a round trip, short enough that
      // nobody watching decides it is broken.
      3000 * 2 ** attempt,
    )

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, token, checkoutPollsLeft, subscription?.current?.status])

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

  function handleToggleDevRecaptchaV3() {
    setDevRecaptchaV3Disabled((current) => {
      const next = !current
      setRecaptchaV3Disabled(next)
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

  /** Shared by a fresh Google sign-in and a retry after the v2 challenge — everything
   * past "we have an id-token and maybe a reCAPTCHA token" is identical. */
  async function finishGoogleLogin(idToken: string, recaptcha?: { token?: string; isFallback?: boolean }) {
    setError('')
    // The modal's own job is done once we have something to submit — close it and hand
    // off to the full-screen overlay so there's a clear "still working" signal for
    // however long sign-in takes. Reopened below only if reCAPTCHA sends us back for a
    // challenge.
    setIsAuthModalOpen(false)
    setBusyMessage(copy.loggingIn)

    try {
      const auth = await loginWithGoogle(idToken, recaptcha)
      pendingGoogleIdToken.current = null
      setNeedsRecaptchaChallenge(false)
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

      // Score too low (or, for the fallback attempt, the checkbox wasn't solved): stay
      // on the modal and swap in the v2 widget instead of showing a dead-end error.
      if (caught instanceof ApiError && caught.code === 'recaptcha_required') {
        pendingGoogleIdToken.current = idToken
        setNeedsRecaptchaChallenge(true)
        setIsAuthModalOpen(true)
      } else {
        setError(caught instanceof Error ? caught.message : copy.loadError)
      }
    } finally {
      setBusyMessage('')
    }
  }

  async function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      setError(copy.loadError)
      return
    }

    // Dev-only escape hatch (see DevToolbar): skipping v3 here is indistinguishable to the
    // backend from a token that failed, so it sends back the same recaptcha_required that
    // real bot traffic would — the fastest way to exercise the v2 fallback UI on demand
    // instead of waiting for an actual low score.
    const recaptchaToken = devRecaptchaV3Disabled
      ? undefined
      : await executeRecaptchaV3(recaptchaSiteKeyV3, 'login').catch(() => undefined)
    await finishGoogleLogin(response.credential, { token: recaptchaToken })
  }

  /** Called once the v2 checkbox is solved — retries the same login with the id-token
   * saved when the v3 score first came back too low. */
  async function handleRecaptchaChallengeSuccess(v2Token: string) {
    const idToken = pendingGoogleIdToken.current
    if (!idToken) {
      setError(copy.loadError)
      return
    }

    await finishGoogleLogin(idToken, { token: v2Token, isFallback: true })
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
    // The allowance belongs to the account that just left — not to whoever signs in next.
    setFreeUnlocks(null)
    setPendingFreeUnlockId(null)
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

  /** "Desbloquear VIP" on a locked card: opens the quick popover — see openVipPopover.
   * Estable por la misma razón que openVipPopover. */
  const requestUnlock = useCallback(() => {
    openVipPopover()
  }, [openVipPopover])

  /**
   * What a locked panel should offer for one card, or `undefined` for the plain VIP
   * upsell. Several things have to be true at once for a free unlock to make sense:
   *
   * - the viewer has no Pro access (with it, nothing is locked to begin with);
   * - the card is free-tier (the paid metrics are the product — never buyable this way);
   * - the account's allowance has been read (a signed-out visitor has none);
   * - there is a live chat to spend it on, since an unlock belongs to one export;
   * - the analysis is a live upload, not a replay. A bundle saved without access was
   *   stored *already stripped* of its details, so spending an unlock on one would cost
   *   a real unlock and reveal nothing. Those get the reprocess hint instead.
   */
  function freeUnlockFor(card: MetricCardData): FreeUnlockPrompt | undefined {
    if (hasVipAccess || card.tier !== 'free' || !freeUnlocks || !activeChat || isReplay) {
      return undefined
    }

    // Already bought for this chat today: the detail is showing, so nothing to offer.
    if (freeUnlockedIds.has(card.id)) {
      return undefined
    }

    const { remaining, dailyLimit } = freeUnlocks
    const label = remaining === 1 ? copy.freeUnlock.ctaOne : copy.freeUnlock.cta.replace('{n}', String(remaining))

    return {
      label,
      // Only worth saying once the allowance is actually gone — a countdown next to
      // "4 restantes" would be answering a question nobody is asking yet.
      waitNote:
        remaining > 0
          ? null
          : copy.freeUnlock.waitNote
              .replace('{limit}', String(dailyLimit))
              .replace('{t}', formatLongWait(secondsUntilFreeUnlockReset)),
      onUse: remaining > 0 ? () => setPendingFreeUnlockId(card.id) : null,
    }
  }

  /**
   * Spends one of the day's unlocks on the metric the confirmation is open for, for the
   * chat on screen.
   *
   * The confirm modal closes the instant this is called — it is a full-screen backdrop,
   * and the wait that follows has to read as "this card is fetching its data," not as
   * the app freezing. So the wait moves into the card's own detail panel instead (see
   * `revealingFreeUnlockId` and `LockedPanel`'s `isRevealing`), timed to a random 3-6s so
   * it never looks like a canned delay.
   *
   * The real spend finishes almost instantly; the randomized wait is what the viewer
   * actually experiences. Once both are done, the account's state is re-read fresh
   * rather than trusting the spend call's own response — if a second unlock was
   * confirmed on another card in the meantime, that response could already be stale by
   * the time this wait ends, and would overwrite a more complete state with an older one.
   */
  async function confirmFreeUnlock() {
    const metricId = pendingFreeUnlockId

    if (!token || !metricId || !activeChat) {
      return
    }

    const sourceHash = activeChat.sourceHash

    setPendingFreeUnlockId(null)
    setRevealingFreeUnlockId(metricId)

    try {
      await Promise.all([spendFreeUnlock(token, metricId, sourceHash), sleep(randomFreeUnlockDelayMs())])
      setFreeUnlocks(await getFreeUnlocks(token, sourceHash))
      // The re-gate itself is free: `analysis` is derived from the core still in memory,
      // so the real detail appears without recomputing a single metric.
    } catch (caught) {
      console.error(caught)
      setError(copy.freeUnlock.error)

      // Whatever went wrong, the allowance the server believes in is the one that
      // counts — re-read it so the button cannot keep offering an unlock that is gone.
      void loadFreeUnlocks(token, sourceHash)
    } finally {
      setRevealingFreeUnlockId(null)
    }
  }

  function cancelFreeUnlock() {
    setPendingFreeUnlockId(null)
  }

  /** Localhost only: hands today's five back so the flow can be walked again. */
  async function handleResetDevFreeUnlocks() {
    if (!token) {
      return
    }

    setIsDevBusy(true)

    try {
      setFreeUnlocks(await resetDevFreeUnlocks(token, activeChat?.sourceHash))
    } catch (caught) {
      console.error(caught)
      setError(caught instanceof Error ? caught.message : copy.loadError)
    } finally {
      setIsDevBusy(false)
    }
  }

  async function processFile(file: File, diagnosticSuffix = '') {
    setError('')
    setBusyMessage(copy.processing)

    try {
      const { messages, sourceHash, rawTextPreview } = await parseChatFile(file)

      if (messages.length === 0) {
        // Un archivo que "parsea" pero no matchea ni una línea es, en la práctica,
        // indistinguible de uno vacío o corrupto — mejor un error accionable (con los
        // datos reales del File recibido y una vista previa de su contenido) que una
        // pantalla de 0 personas / 0 mensajes que parece haber funcionado.
        const fileInfo = `${file.name || 'sin nombre'} · ${file.type || 'sin tipo'} · ${file.size} bytes`
        const preview = rawTextPreview ? ` · content: "${rawTextPreview}"` : ''
        throw new Error(`${copy.emptyChatError} [${fileInfo}${preview}]${diagnosticSuffix}`)
      }

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
    } catch (caught) {
      // Sin este catch el rechazo quedaba sin manejar: el análisis seguía en pantalla,
      // el historial no se actualizaba y nadie se enteraba de que el guardado falló.
      // El caso más probable es el tope de análisis por cuenta, que tiene copy propio
      // porque la salida es concreta (borrar uno del historial), no "probá de nuevo".
      console.error(caught)
      setError(
        caught instanceof ApiError && caught.code === 'analysis_limit_reached'
          ? copy.saveLimitError
          : copy.saveError,
      )
    } finally {
      setBusyMessage('')
    }
  }

  function requestDeleteAnalysis(item: SavedAnalysis) {
    setPendingDeleteId(item.id)
  }

  function cancelDeleteAnalysis() {
    setPendingDeleteId(null)
  }

  /**
   * Borra un análisis del historial.
   *
   * Si el que se borra es justo el que está en pantalla (un replay desde el
   * historial), se vuelve al inicio: seguir mostrando un análisis que la cuenta ya
   * no tiene es prometer un "Ver más" que la próxima recarga no va a cumplir.
   */
  async function confirmDeleteAnalysis() {
    const id = pendingDeleteId

    if (!token || !id) {
      return
    }

    const target = savedAnalyses.find((item) => item.id === id) ?? null
    setIsDeletingAnalysis(true)

    try {
      await deleteAnalysis(token, id)
      setSavedAnalyses((current) => current.filter((item) => item.id !== id))

      if (isReplay && target && replayedAnalysis?.sourceHash === target.sourceHash) {
        backToLanding()
      }
    } catch (caught) {
      console.error(caught)
      setError(copy.deleteSavedError)
    } finally {
      setIsDeletingAnalysis(false)
      setPendingDeleteId(null)
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
  /* Memoizado por lo mismo que requestUnlock: es un objeto nuevo en cada render
     y baja como prop a las 25 tarjetas, así que su identidad decide si el memo
     de MetricCard/MetricRow sirve o no. */
  const canRetryAi = Boolean(activeChat && core)
  const aiPanel: AiPanelProps | undefined = useMemo(
    () =>
      hasVipAccess
        ? {
            copy: copy.ai,
            canRetry: canRetryAi,
            isBusy: isAiBusy,
            onRetry: handleAiRetry,
            onConsent: () => setIsConsentModalOpen(true),
          }
        : undefined,
    // handleAiRetry se redeclara en cada render, pero lee todo de refs y de estado
    // que ya están en esta lista; incluirlo anularía el memo sin agregar frescura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasVipAccess, copy.ai, canRetryAi, isAiBusy],
  )

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

  // The card a confirmation is currently open for — looked up rather than stashed, so it
  // can never name a metric that has since left the list.
  const pendingFreeUnlockMetric = useMemo(
    () => interleavedMetrics.find((card) => card.id === pendingFreeUnlockId) ?? null,
    [interleavedMetrics, pendingFreeUnlockId],
  )

  /** Igual que arriba: buscado, no guardado, así el diálogo nunca nombra un análisis
   * que ya salió de la lista. */
  const pendingDeleteAnalysis = useMemo(
    () => savedAnalyses.find((item) => item.id === pendingDeleteId) ?? null,
    [savedAnalyses, pendingDeleteId],
  )

  /**
   * Publishes the current run as a public link and returns its URL.
   *
   * Shares what the viewer can *see right now* — `interleavedMetrics` is the already-gated
   * list, so a Pro subscriber shares everything and a free account shares the free cards
   * plus whatever today's unlocks opened. That is the whole contract of the link: it is a
   * snapshot of this viewer's access at this moment, and it stops changing the instant it
   * is created.
   *
   * Literal message text is dropped by `buildSharePayload` before the request is built, so
   * it never leaves the browser (the server strips it again — see SharePayloadSanitizer).
   */
  async function createStoryLink(): Promise<string> {
    if (!token || !analysis) {
      throw new Error('A signed-in session and a loaded chat are required to share.')
    }

    const { slug } = await createShare(token, {
      chatName: analysis.chatName,
      dateRangeLabel: analysis.dateRangeLabel,
      sourceHash: analysis.sourceHash,
      language,
      messageCount: analysis.messageCount,
      participantCount: analysis.participantCount,
      cardsJson: JSON.stringify(buildSharePayload(interleavedMetrics)),
    })

    return shareUrlFor(slug)
  }

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
    pendingDeleteAnalysis,
    isDeletingAnalysis,
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
    needsRecaptchaChallenge,
    recaptchaSiteKeyV2,
    recaptchaSiteKeyV3,
    isExportTutorialOpen,
    setIsExportTutorialOpen,
    isVipPopoverOpen,
    setIsVipPopoverOpen,

    // --- desbloqueos gratuitos diarios ---
    freeUnlocks,
    freeUnlockFor,
    pendingFreeUnlockMetric,
    revealingFreeUnlockId,
    confirmFreeUnlock,
    cancelFreeUnlock,

    // --- sólo en localhost ---
    showDevTools,
    devAiDisabled,
    devRecaptchaV3Disabled,
    isDevBusy,

    // --- acciones ---
    // --- recorrido compartido ---
    shareSlug,
    createStoryLink,

    navigateTo,
    goToSubscriptionPage,
    openVipPopover,
    requestUnlock,
    requestUpload,
    openFilePicker,
    processFile,
    handleFileSelection,
    handleGoogleSuccess,
    handleRecaptchaChallengeSuccess,
    handleLogout,
    handleCancelSubscription,
    handlePauseSubscription,
    handleResumeSubscription,
    handleRefreshSubscription,
    handleAiRetry,
    handleConsentAccept,
    handleToggleDevAi,
    handleToggleDevRecaptchaV3,
    handleToggleDevSubscription,
    handleResetDevFreeUnlocks,
    openSavedAnalysis,
    requestDeleteAnalysis,
    cancelDeleteAnalysis,
    confirmDeleteAnalysis,
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

// Long enough to read as "fetching something real," short enough not to feel broken;
// randomized within the range so it never looks like a canned constant. See
// confirmFreeUnlock, the only caller.
const FREE_UNLOCK_MIN_DELAY_MS = 3000
const FREE_UNLOCK_MAX_DELAY_MS = 6000

function randomFreeUnlockDelayMs(): number {
  return FREE_UNLOCK_MIN_DELAY_MS + Math.random() * (FREE_UNLOCK_MAX_DELAY_MS - FREE_UNLOCK_MIN_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
