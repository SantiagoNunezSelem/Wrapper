import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import './App.css'
import { CrossButton } from './components/IconButton'
import { LoadingOverlay } from './components/LoadingOverlay'
import { MetricCard } from './components/MetricCard'
import { MetricModal } from './components/MetricModal'
import { VipBadge } from './components/VipBadge'
import { analyzeInWorker } from './lib/analysisClient'
import { getCurrentUser, listAnalyses, loginWithGoogle, saveAnalysis } from './lib/api'
import { getLandingPreviewCards } from './lib/landingPreview'
import { formatNumber, gateAnalysis, type AnalysisCore } from './lib/metrics'
import { parseChatFile } from './lib/parser'
import { useInView } from './lib/useInView'
import type {
  AnalysisBundle,
  ChatMessage,
  Language,
  MetricCard as MetricCardData,
  SavedAnalysis,
  UserProfile,
} from './types'

const authTokenKey = 'wrapper-crm-auth-token'

const landingMockupStats = {
  es: [
    { value: '76%', label: 'Fran domina la charla' },
    { value: '00:43', label: 'Pico de mensajes nocturnos' },
    { value: '9', label: 'Mensajes seguidos sin respuesta' },
  ],
  en: [
    { value: '76%', label: 'Fran dominates the chat' },
    { value: '12:43 AM', label: 'Late-night message peak' },
    { value: '9', label: 'Messages in a row with no reply' },
  ],
} as const

const shellCopy = {
  es: {
    title: { prefix: 'Tu chat también merece su propio', highlight: 'Wrapped' },
    landingSubtitle:
      'Subí un export de WhatsApp y descubrí quién monologuea, quién clava el visto, qué horarios dominan y dónde explota la conversación.',
    heroCaption: 'Privado, visual y un poquito picante.',
    whatItDoesTitle: '¿Para qué sirve?',
    whatItDoesBody:
      'La app procesa el chat en tu navegador, calcula métricas divertidas y guarda solo resultados agregados cuando decidís iniciar sesión.',
    trustBadges: ['🔒 100% local, tu chat nunca se sube', '⚡ Resultados en segundos', '🆓 Empezá gratis, sin tarjeta'],
    marqueeItems: [
      '🚩 Detector de Red Flags',
      '😂 Analizador de risas',
      '🔥 Tono picante',
      '🕐 Reloj biológico',
      '☁️ Nube de palabras',
      '📈 +20 estadísticas',
      '🔒 100% privado',
    ],
    howItWorksTitle: 'Cómo funciona',
    howItWorksSteps: [
      { title: 'Subí tu chat', body: 'Exportá la conversación desde WhatsApp (.txt o .zip) y soltala acá.' },
      { title: 'Se procesa en tu navegador', body: 'Nada del texto crudo sale de tu dispositivo: solo calculamos métricas.' },
      { title: 'Mirá tu Wrapped', body: 'Recorré tarjetas tipo historia con los datos más divertidos del chat.' },
      { title: 'Desbloqueá lo picante', body: 'Con VIP accedés a red flags, tono picante, sentimiento y mucho más.' },
    ],
    examplesTitle: 'Así se sienten las analíticas',
    examplesSubtitle: 'Estos números son de ejemplo — subí tu chat para ver los tuyos, sin vueltas.',
    demoTag: 'Ejemplo',
    setupWarning:
      'Falta configurar VITE_GOOGLE_CLIENT_ID en el frontend o GoogleAuth:AllowedAudience en el backend.',
    loginHeadline: 'Iniciá sesión para guardar tu Wrapped y desbloquear el usuario VIP',
    loginAfterUpload: 'Tu análisis ya está listo. Si querés guardarlo y ver tu historial, iniciá sesión ahora.',
    vipUpsellNote:
      'La suscripción VIP todavía no se puede activar desde acá. Iniciá sesión con la cuenta configurada como admin para probarla en este entorno.',
    uploadTitle: 'Subí un .txt o .zip exportado desde WhatsApp',
    uploadHint: 'Podés subir primero y loguearte después. El procesamiento sigue siendo local.',
    saveInfo: 'El backend guarda solo el JSON agregado del análisis, nunca el texto crudo del chat.',
    uploadCta: 'Subir archivo',
    startNow: 'Probar ahora',
    vipOn: 'VIP activo',
    vipOff: 'VIP bloqueado',
    savedTitle: 'Historial guardado',
    noSaved: 'Todavía no hay análisis guardados para este usuario.',
    openSaved: 'Abrir',
    chatSummaryTitle: 'Resumen del chat',
    logout: 'Cerrar sesión',
    processing: 'Procesando archivo...',
    analyzing: 'Analizando tu chat...',
    saving: 'Guardando análisis...',
    loggingIn: 'Iniciando sesión...',
    overlaySubtitle: 'Aguardá unos minutos mientras procesamos la información.',
    account: 'Cuenta',
    subscription: 'Suscripción',
    participants: 'Participantes',
    messages: 'Mensajes',
    generatedAt: 'Generado',
    loadError: 'No pude completar la acción.',
    login: 'Iniciar sesión',
    backToLanding: 'Volver a la landing',
    seeMore: 'Ver más',
    close: 'Cerrar',
    detailTitle: 'Desglose completo',
    breakdownTitle: 'Por integrante',
    showMore: 'Mostrar más',
    unlock: 'Desbloquear VIP',
    searchPlaceholder: 'Buscar una palabra…',
    metricsTitle: 'Tu Wrapped completo',
    metricsSubtitle: 'Cada tarjeta tiene un resultado directo. Las bloqueadas se destapan con VIP.',
    savePromptTitle: 'Guardá este Wrapped',
    savePromptBody: 'Iniciá sesión con Google para no perderlo y volver a verlo cuando quieras.',
    reprocessHint: 'Este análisis se guardó sin acceso VIP. Volvé a subir el chat para ver el detalle completo desbloqueado.',
    whyTitle: 'Qué podés descubrir',
    whyCards: [
      {
        icon: '🗣️',
        title: 'Quién domina la charla',
        body: 'Rachas de mensajes seguidos, quién escribe más y quién sobrevive con monosílabos.',
      },
      {
        icon: '🌙',
        title: 'Cuándo se prende el chat',
        body: 'Horarios pico, búhos vs. madrugadores, y los días que hicieron explotar la conversación.',
      },
      {
        icon: '🚩',
        title: 'Lo que nadie se anima a preguntar',
        body: 'Demoras, silencios, red flags y tono picante — desbloqueado con VIP.',
      },
    ],
    footerPrivacy:
      'Tus mensajes se procesan en tu navegador y nunca se suben a un servidor. Solo guardamos métricas agregadas cuando iniciás sesión.',
    footerRights: 'Hecho con demasiado jajaja.',
  },
  en: {
    title: { prefix: 'Your chat deserves its own', highlight: 'Wrapped' },
    landingSubtitle:
      'Upload a WhatsApp export and uncover who monologues, who leaves you on seen, which hours dominate, and when the conversation explodes.',
    heroCaption: 'Private, visual, and a little spicy.',
    whatItDoesTitle: 'What is it for?',
    whatItDoesBody:
      'The app processes the chat in your browser, computes playful metrics, and only stores aggregated results once you decide to sign in.',
    trustBadges: ['🔒 100% local — your chat is never uploaded', '⚡ Results in seconds', '🆓 Start free, no card needed'],
    marqueeItems: [
      '🚩 Red Flag Detector',
      '😂 Laugh Analyzer',
      '🔥 Spicy Tone',
      '🕐 Body Clock',
      '☁️ Word Cloud',
      '📈 20+ stats',
      '🔒 100% private',
    ],
    howItWorksTitle: 'How it works',
    howItWorksSteps: [
      { title: 'Upload your chat', body: 'Export the conversation from WhatsApp (.txt or .zip) and drop it here.' },
      { title: "It's processed in your browser", body: 'None of the raw text leaves your device — we only compute metrics.' },
      { title: 'See your Wrapped', body: 'Swipe through story-style cards with the most fun stats from the chat.' },
      { title: 'Unlock the spicy stuff', body: 'VIP gets you red flags, spicy tone, sentiment, and a lot more.' },
    ],
    examplesTitle: 'This is how the analytics feel',
    examplesSubtitle: "These numbers are just an example — upload your chat to see your own, no strings attached.",
    demoTag: 'Example',
    setupWarning:
      'VITE_GOOGLE_CLIENT_ID in the frontend or GoogleAuth:AllowedAudience in the backend is still missing.',
    loginHeadline: 'Sign in to save your Wrapped and unlock the VIP admin user',
    loginAfterUpload: 'Your analysis is ready. Sign in now if you want to save it and keep a history.',
    vipUpsellNote:
      "VIP subscriptions can't be activated from here yet. Sign in with the account configured as admin to try it in this environment.",
    uploadTitle: 'Upload a WhatsApp-exported .txt or .zip',
    uploadHint: 'You can upload first and sign in later. Processing still happens locally.',
    saveInfo: 'The backend stores only aggregated JSON results, never the raw chat text.',
    uploadCta: 'Upload file',
    startNow: 'Try it now',
    vipOn: 'VIP active',
    vipOff: 'VIP locked',
    savedTitle: 'Saved history',
    noSaved: 'There are no saved analyses for this user yet.',
    openSaved: 'Open',
    chatSummaryTitle: 'Chat summary',
    logout: 'Sign out',
    processing: 'Processing file...',
    analyzing: 'Analyzing your chat...',
    saving: 'Saving analysis...',
    loggingIn: 'Signing in...',
    overlaySubtitle: 'Please wait a few minutes while we process the information.',
    account: 'Account',
    subscription: 'Subscription',
    participants: 'Participants',
    messages: 'Messages',
    generatedAt: 'Generated',
    loadError: 'I could not complete the action.',
    login: 'Sign in',
    backToLanding: 'Back to landing',
    seeMore: 'See more',
    close: 'Close',
    detailTitle: 'Full breakdown',
    breakdownTitle: 'By participant',
    showMore: 'Show more',
    unlock: 'Unlock VIP',
    searchPlaceholder: 'Search a word…',
    metricsTitle: 'Your full Wrapped',
    metricsSubtitle: 'Every card shows a straight-to-the-point result. Locked ones unlock with VIP.',
    savePromptTitle: 'Save this Wrapped',
    savePromptBody: "Sign in with Google so you don't lose it — come back to it whenever you want.",
    reprocessHint: 'This analysis was saved without VIP access. Re-upload the chat to see the full unlocked detail.',
    whyTitle: 'What you can discover',
    whyCards: [
      {
        icon: '🗣️',
        title: 'Who dominates the chat',
        body: 'Back-to-back streaks, who writes the most, and who survives on one-word replies.',
      },
      {
        icon: '🌙',
        title: 'When the chat comes alive',
        body: 'Peak hours, night owls vs. early birds, and the days that made the conversation explode.',
      },
      {
        icon: '🚩',
        title: 'The stuff nobody asks about out loud',
        body: 'Delays, silences, red flags, and spicy tone — unlocked with VIP.',
      },
    ],
    footerPrivacy:
      'Your messages are processed in your browser and never uploaded to a server. We only store aggregated metrics once you sign in.',
    footerRights: 'Made with way too much "hahaha".',
  },
} as const

interface ActiveChat {
  chatName: string
  messages: ChatMessage[]
  sourceHash: string
}

function App() {
  const [language, setLanguage] = useState<Language>(
    navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en',
  )
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem(authTokenKey))
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([])
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisBundle | null>(null)
  const [isReplay, setIsReplay] = useState(false)
  const [pendingPersist, setPendingPersist] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)

  const copy = shellCopy[language]
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  // The expensive part of analysis (every metric, computed in a Web Worker) never
  // depends on VIP status — only which fields get exposed does (see gateAnalysis).
  // Caching one core per (sourceHash, language) means unlocking VIP after login is
  // a synchronous re-gate, not a second multi-second recompute.
  const analysisCoreCache = useRef<Map<string, AnalysisCore>>(new Map())

  // Landing page sections reveal as they're scrolled into view, each tracked
  // independently so the page animates in stages instead of all at once.
  const heroReveal = useInView<HTMLElement>()
  const infoReveal = useInView<HTMLElement>()
  const stepsReveal = useInView<HTMLElement>()
  const examplesReveal = useInView<HTMLElement>()
  const uploadReveal = useInView<HTMLElement>()

  // The phone screen tilts slightly toward the cursor — a small 3D parallax
  // touch, damped to a ±10deg range so it reads as responsive, not gimmicky.
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

  useEffect(() => {
    if (!token) {
      return
    }

    void hydrateSession(token)
  }, [token])

  // Recompute locally whenever the underlying chat, language, or VIP entitlement
  // changes. Locked cards never carry real numbers in `analysis` in the first
  // place (see gateAnalysis), so unlocking means re-gating an already-computed
  // core still held in memory — never a server round trip, and (see cache above)
  // almost never a second worker computation either.
  useEffect(() => {
    if (!activeChat) {
      return
    }

    const hasVipAccess = Boolean(user?.hasVipAccess)
    const cacheKey = `${activeChat.sourceHash}:${language}`
    const cached = analysisCoreCache.current.get(cacheKey)

    if (cached) {
      // Re-gating is synchronous and cheap — clear whatever busy state handed off
      // to us (a fresh upload, or nothing at all if only VIP access changed).
      setBusyMessage('')
      setAnalysis(gateAnalysis(cached, hasVipAccess))
      return
    }

    // Guard against setting stale results if activeChat or language changes again
    // before the worker responds.
    let cancelled = false
    setBusyMessage(copy.analyzing)

    analyzeInWorker(activeChat.chatName, activeChat.messages, language, activeChat.sourceHash)
      .then((core) => {
        if (cancelled) {
          return
        }
        analysisCoreCache.current.set(cacheKey, core)
        setAnalysis(gateAnalysis(core, hasVipAccess))
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }
        console.error(caught)
        setError(caught instanceof Error ? caught.message : copy.loadError)
      })
      .finally(() => {
        if (!cancelled) {
          setBusyMessage('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeChat, language, user?.hasVipAccess])

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

  // The account dropdown has no backdrop of its own (unlike the auth/metric
  // modals) — it closes on any click outside the pill instead, checked on
  // mousedown so it doesn't swallow the click that opened it or race with
  // whatever else that outside click was meant to do (e.g. backToLanding).
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
    setIsAccountMenuOpen(false)
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function requestUnlock() {
    setIsAuthModalOpen(true)
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setError('')
    setBusyMessage(copy.processing)

    try {
      const { messages, sourceHash } = await parseChatFile(file)
      setIsReplay(false)
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
    } finally {
      event.target.value = ''
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
    setIsReplay(true)
    setPendingPersist(false)
    setAnalysis(JSON.parse(item.resultsJson) as AnalysisBundle)
    setSelectedMetricId(null)
  }

  function backToLanding() {
    setAnalysis(null)
    setActiveChat(null)
    setIsReplay(false)
    setSelectedMetricId(null)
  }

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
                    {copy.subscription}: <strong>{user.subscriptionState}</strong>
                  </p>
                  <VipBadge active={user.hasVipAccess} label={user.hasVipAccess ? copy.vipOn : copy.vipOff} compact />
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
                {busyMessage || copy.uploadCta}
              </button>
              <CrossButton label={copy.backToLanding} onClick={backToLanding} />
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

          <section className={`panel upload-strip reveal ${uploadReveal.inView ? 'is-visible' : ''}`} ref={uploadReveal.ref}>
            <div>
              <h2>{copy.uploadTitle}</h2>
              <p className="panel-copy">{copy.saveInfo}</p>
              <p className="panel-copy upload-strip-hint">{copy.uploadHint}</p>
            </div>

            <button type="button" className="primary-button" onClick={openFilePicker}>
              {busyMessage || copy.uploadCta}
            </button>
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

      {isAuthModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsAuthModalOpen(false)}>
          <section className="modal-card auth-modal" onClick={(event) => event.stopPropagation()}>
            <CrossButton label={copy.close} onClick={() => setIsAuthModalOpen(false)} className="close-button" />
            <p className="eyebrow">Google Login</p>
            <h2>{copy.loginHeadline}</h2>

            {user ? (
              <p className="panel-copy">{copy.vipUpsellNote}</p>
            ) : (
              <>
                <p className="panel-copy">{activeChat ? copy.loginAfterUpload : copy.saveInfo}</p>
                {hasGoogleClientId ? (
                  <GoogleLogin
                    onSuccess={(credentialResponse) => {
                      void handleGoogleSuccess(credentialResponse)
                    }}
                    onError={() => setError(copy.loadError)}
                  />
                ) : null}
              </>
            )}
          </section>
        </div>
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
          onClose={() => setSelectedMetricId(null)}
          onUnlock={requestUnlock}
        />
      ) : null}

      {busyMessage ? <LoadingOverlay title={busyMessage} subtitle={copy.overlaySubtitle} /> : null}
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

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
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

export default App
