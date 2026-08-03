import { type CredentialResponse } from '@react-oauth/google'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import './App.css'
import { AiConsentModal } from './components/AiConsentModal'
import type { AiPanelProps } from './components/AiStatePanel'
import { DevToolbar } from './components/DevToolbar'
import { CrossButton } from './components/IconButton'
import { FileUploadZone } from './components/FileUploadZone'
import { LoadingOverlay } from './components/LoadingOverlay'
import { MetricCard } from './components/MetricCard'
import { MetricModal } from './components/MetricModal'
import { ResponsiveGoogleLogin } from './components/ResponsiveGoogleLogin'
import { SubscriptionPage } from './components/SubscriptionPage'
import { VipBadge } from './components/VipBadge'
import { VipUnlockPopover } from './components/VipUnlockPopover'
import { toAcceptedMessageIds, type AiCandidateSet } from './lib/aiCandidates'
import { analyzeInWorker, applyAiVerdictsInWorker, buildAiCandidatesInWorker } from './lib/analysisClient'
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
} from './lib/api'
import { isAiDisabled as readAiDisabled, isLocalhost, setAiDisabled } from './lib/devFlags'
import { getLandingPreviewCards } from './lib/landingPreview'
import {
  aiMetricIds,
  formatNumber,
  gateAnalysis,
  isAiMetricId,
  type AiCardStates,
  type AiMetricId,
  type AnalysisCore,
} from './lib/metrics'
import { parseChatFile } from './lib/parser'
import { useInView } from './lib/useInView'
import type {
  AiMetricStatus,
  AnalysisBundle,
  ChatMessage,
  Language,
  MetricCard as MetricCardData,
  SavedAnalysis,
  SubscriptionOverview,
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
      'La app procesa el chat en tu navegador, calcula métricas divertidas y guarda solo resultados agregados cuando decidís iniciar sesión. Las dos métricas Pro con IA son la única excepción, y te pedimos permiso antes.',
    trustBadges: ['🔒 Tu chat se procesa en tu navegador', '⚡ Resultados en segundos', '🆓 Empezá gratis, sin tarjeta'],
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
      { title: 'Se procesa en tu navegador', body: 'Las métricas se calculan ahí mismo: el chat completo nunca se sube.' },
      { title: 'Mirá tu Wrapped', body: 'Recorré tarjetas tipo historia con los datos más divertidos del chat.' },
      { title: 'Desbloqueá lo picante', body: 'Con VIP accedés a red flags, tono picante, sentimiento y mucho más.' },
    ],
    examplesTitle: 'Así se sienten las analíticas',
    examplesSubtitle: 'Estos números son de ejemplo — subí tu chat para ver los tuyos, sin vueltas.',
    demoTag: 'Ejemplo',
    setupWarning:
      'Falta configurar VITE_GOOGLE_CLIENT_ID en el frontend o GoogleAuth:AllowedAudience en el backend.',
    loginHeadline: 'Iniciá sesión para guardar tu Wrapped y desbloquear las métricas Pro',
    loginAfterUpload: 'Tu análisis ya está listo. Si querés guardarlo y ver tu historial, iniciá sesión ahora.',
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
    analyzingAi: 'Analizando las métricas Pro con IA...',
    saving: 'Guardando análisis...',
    loggingIn: 'Iniciando sesión...',
    overlaySubtitle: 'Aguardá unos minutos mientras procesamos la información.',
    aiPartialError:
      'No pudimos procesar algunas métricas con IA. El resto de tu Wrapped está completo — probá de nuevo en unos instantes.',
    ai: {
      failedTitle: 'No pudimos analizar esta métrica con IA',
      reasons: {
        quota: 'Nos quedamos sin cupo de IA por un momento.',
        unavailable: 'La IA no respondió a tiempo.',
        blocked: 'La IA no pudo evaluar estos mensajes.',
        invalid: 'La IA devolvió una respuesta inesperada.',
        config: 'El análisis con IA no está configurado en el servidor.',
        default: 'No pudimos procesar la solicitud con IA.',
      },
      retry: 'Volver a analizar',
      retryIn: 'Vas a poder reintentar en {time}',
      retrying: 'Analizando...',
      needsUpload: 'Subí el chat de nuevo para reintentar',
      consentTitle: 'Métrica con IA',
      consentBody: 'Activá el análisis con IA para ver esta métrica sin falsos positivos.',
      consentCta: 'Activar análisis con IA',
      unavailableTitle: 'IA no disponible',
      unavailableBody: 'Esta instalación todavía no tiene configurado el análisis con IA.',
      pendingTitle: 'Analizando con IA',
      pendingBody: 'Estamos revisando los mensajes marcados. Tarda unos segundos.',
    },
    consent: {
      eyebrow: 'Un permiso, una sola vez',
      title: 'Análisis con IA para dos métricas Pro',
      body:
        'El Detector de Red Flags y El Tono Picante usan filtros de palabras que se equivocan seguido: sin IA, "la comida estaba caliente" cuenta como mensaje subido de tono. La IA revisa esos mensajes marcados y descarta los que no corresponden.',
      bullets: [
        'Solo se envían los mensajes que ya pasaron el filtro de palabras, recortados y con un par de líneas de contexto.',
        'No viajan nombres: cada participante aparece como una letra.',
        'El resto del chat se sigue procesando en tu navegador y nunca sale de tu dispositivo.',
        'El resultado se guarda una sola vez por chat: no se vuelve a analizar ni a cobrar.',
      ],
      accept: 'Activar y analizar',
      decline: 'Ahora no',
      working: 'Activando...',
    },
    manageSubscription: 'Gestionar suscripción',
    vipPopover: {
      eyebrow: 'Métricas Pro',
      title: 'Desbloqueá VIP',
      close: 'Cerrar',
      signInPrompt: 'Iniciá sesión con tu cuenta de Google para suscribirte.',
      signInCta: 'Iniciar sesión',
    },
    subscriptionPage: {
      eyebrow: 'Cuenta',
      title: 'Suscripción',
      lead: 'Gestioná tu plan Pro: beneficios, facturación y cancelación.',
      backToApp: 'Volver a Vistazo',
      signInPrompt: 'Iniciá sesión con tu cuenta de Google para suscribirte y ver el estado de tu cuenta.',
      signInCta: 'Iniciar sesión',
      close: 'Cerrar',
      statuses: {
        pendiente: 'Pendiente de pago',
        trial: 'Prueba gratis',
        activa: 'Activa',
        pago_fallido: 'Pago rechazado',
        pausada: 'Pausada',
        cancelada: 'Cancelada',
        inactiva: 'Sin suscripción',
      },
      statusHints: {
        pendiente: 'Falta completar el pago en Mercado Pago. Podés retomarlo cuando quieras.',
        trial: 'Tenés acceso Pro completo. Si cancelás antes de que termine, no se te cobra nada.',
        activa: 'Se renueva sola todos los meses. La podés cancelar cuando quieras.',
        pago_fallido: 'No pudimos cobrar tu tarjeta. Mercado Pago va a reintentar; mientras tanto mantenés el acceso.',
        pausada: 'No se van a hacer cobros nuevos. Conservás el acceso hasta que termine el período pago.',
        cancelada: 'No se renueva más. Conservás el acceso hasta que termine el período que ya pagaste.',
        inactiva: 'No tenés una suscripción activa.',
      },
      currentPlanTitle: 'Tu plan',
      perMonth: 'por mes',
      freeTrialBadge: '7 días gratis',
      trialEndsOn: 'La prueba termina el',
      renewsOn: 'Próximo cobro',
      endsOn: 'Acceso hasta el',
      graceUntil: 'Acceso garantizado hasta el',
      paymentMethod: 'Medio de pago',
      startedOn: 'Comenzó el',
      lastPayment: 'Último pago',
      cancelCta: 'Cancelar renovación',
      cancelConfirmTitle: '¿Cancelar la renovación automática?',
      cancelConfirmBody:
        'No se te vuelve a cobrar. Mantenés el acceso Pro hasta el {date}, y podés volver a suscribirte cuando quieras.',
      cancelConfirmYes: 'Sí, cancelar',
      cancelConfirmNo: 'Volver',
      refreshCta: 'Actualizar estado',
      refreshing: 'Actualizando...',
      cancelling: 'Cancelando...',
      billedBy: 'Renovación automática',
      autoRenewOn: 'Activada',
      autoRenewOff: 'Desactivada',
      adminNote: 'Tenés acceso Pro por ser administrador, no por una suscripción paga.',
      devNote: 'Suscripción simulada desde el panel local. No corresponde a un pago real.',
      paymentsDisabled: 'Los pagos todavía no están configurados en el servidor.',
      plansTitle: 'Planes disponibles',
      planName: 'Plan mensual',
      planDurationLabel: 'Duración',
      planDurationValue: 'Se renueva automáticamente cada mes',
      planAccessLabel: 'Acceso',
      planAccessValue: 'Todas las métricas Pro, activo apenas se confirma el pago',
      planTrialNote:
        '✨ Tu primera suscripción incluye 7 días de prueba gratis. Cancelá antes de que termine y no se te cobra nada.',
      planBenefitsLabel: 'Qué incluye',
      planBenefits: [
        'Detector de Red Flags y Tono Picante, verificados con IA',
        'Sentimiento, reloj biológico y el resto de las métricas Pro',
        'Desglose completo por integrante en cada tarjeta',
        'Historial ilimitado de chats guardados',
      ],
      buyCta: 'Comprar',
      buyTrialCta: 'Empezar con 7 días gratis',
      trialUnavailable: 'La semana gratis ya fue usada.',
      trialReasons: {
        account_used: 'Esta cuenta ya la aprovechó.',
        ip_used: 'Ya se usó desde esta conexión.',
        network_used: 'Ya se usó desde esta red.',
        device_used: 'Ya se usó desde este dispositivo.',
        country_not_allowed: 'No está disponible en tu país.',
      },
      cardStepTitle: 'Método de pago',
      cardStepBack: 'Volver',
      cardCheckout: {
        missingKey: 'Los pagos todavía no están configurados en el servidor.',
        loading: 'Cargando el formulario de pago...',
        tokenMissing: 'Por ahora las suscripciones solo funcionan con tarjeta de crédito o débito — elegí esa opción para continuar.',
        securedBy: 'Pago procesado de forma segura por Mercado Pago',
      },
      submitting: 'Confirmando con Mercado Pago...',
      genericError: 'No pudimos procesar el pago. Probá de nuevo.',
      successTitle: '¡Listo!',
      successTrialBody: 'Arrancó tu semana gratis. Te avisamos antes del primer cobro.',
      successActiveBody: 'Tu suscripción Pro ya está activa.',
      successCta: 'Entendido',
      invoicesTitle: 'Historial de pagos',
      noInvoices: 'Todavía no hay cobros registrados.',
      invoiceStatuses: {
        aprobado: 'Aprobado',
        rechazado: 'Rechazado',
        pendiente: 'Pendiente',
        reintentando: 'Reintentando',
        devuelto: 'Devuelto',
      },
      invoicePeriod: 'Período {from} — {to}',
      invoiceAttempt: 'Intento {n}',
      historyTitle: 'Historial de suscripciones',
      noHistory: 'Todavía no hay suscripciones registradas.',
      eventsTitle: 'Actividad de la cuenta',
      noEvents: 'Sin movimientos registrados.',
    },
    dev: {
      badge: 'local',
      aiOn: 'IA activada',
      aiOff: 'IA desactivada',
      aiOnHint: 'Se consultan las métricas con IA al importar un chat. Click para desactivar y no gastar tokens.',
      aiOffHint: 'No se consulta la IA al importar un chat. Click para volver a activarla.',
      vipOn: 'Activar suscripción',
      vipOff: 'Desactivar suscripción',
      vipHint: 'Simula una suscripción Pro sin pasar por Mercado Pago.',
      signInFirst: 'Iniciá sesión para usar este atajo.',
      dragHint: 'Arrastrá para mover · doble click para volver a la esquina',
    },
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
      'Tus mensajes se procesan en tu navegador y el chat nunca se sube entero. Solo guardamos métricas agregadas cuando iniciás sesión. Con Pro, y únicamente si lo autorizás, dos métricas envían los mensajes ya marcados por el filtro —recortados y sin nombres— para que una IA los revise.',
    footerRights: 'Hecho con demasiado jajaja.',
  },
  en: {
    title: { prefix: 'Your chat deserves its own', highlight: 'Wrapped' },
    landingSubtitle:
      'Upload a WhatsApp export and uncover who monologues, who leaves you on seen, which hours dominate, and when the conversation explodes.',
    heroCaption: 'Private, visual, and a little spicy.',
    whatItDoesTitle: 'What is it for?',
    whatItDoesBody:
      'The app processes the chat in your browser, computes playful metrics, and only stores aggregated results once you decide to sign in. The two AI-powered Pro metrics are the single exception, and we ask first.',
    trustBadges: ['🔒 Your chat is processed in your browser', '⚡ Results in seconds', '🆓 Start free, no card needed'],
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
      { title: "It's processed in your browser", body: 'Metrics are computed right there — the full chat is never uploaded.' },
      { title: 'See your Wrapped', body: 'Swipe through story-style cards with the most fun stats from the chat.' },
      { title: 'Unlock the spicy stuff', body: 'VIP gets you red flags, spicy tone, sentiment, and a lot more.' },
    ],
    examplesTitle: 'This is how the analytics feel',
    examplesSubtitle: "These numbers are just an example — upload your chat to see your own, no strings attached.",
    demoTag: 'Example',
    setupWarning:
      'VITE_GOOGLE_CLIENT_ID in the frontend or GoogleAuth:AllowedAudience in the backend is still missing.',
    loginHeadline: 'Sign in to save your Wrapped and unlock the Pro metrics',
    loginAfterUpload: 'Your analysis is ready. Sign in now if you want to save it and keep a history.',
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
    analyzingAi: 'Analyzing the Pro metrics with AI...',
    saving: 'Saving analysis...',
    loggingIn: 'Signing in...',
    overlaySubtitle: 'Please wait a few minutes while we process the information.',
    aiPartialError:
      "We couldn't process some metrics with AI. The rest of your Wrapped is complete — try again in a moment.",
    ai: {
      failedTitle: "We couldn't analyze this metric with AI",
      reasons: {
        quota: 'We ran out of AI credit for a moment.',
        unavailable: "The AI didn't answer in time.",
        blocked: "The AI couldn't evaluate these messages.",
        invalid: 'The AI returned an unexpected answer.',
        config: 'AI analysis is not configured on the server.',
        default: "We couldn't process the AI request.",
      },
      retry: 'Analyze again',
      retryIn: 'You can retry in {time}',
      retrying: 'Analyzing...',
      needsUpload: 'Upload the chat again to retry',
      consentTitle: 'AI-powered metric',
      consentBody: 'Turn on AI analysis to see this metric without false positives.',
      consentCta: 'Turn on AI analysis',
      unavailableTitle: 'AI unavailable',
      unavailableBody: 'This installation does not have AI analysis configured yet.',
      pendingTitle: 'Analyzing with AI',
      pendingBody: 'We are reviewing the flagged messages. It takes a few seconds.',
    },
    consent: {
      eyebrow: 'One permission, just once',
      title: 'AI analysis for two Pro metrics',
      body:
        'The Red Flag Detector and The Spicy Tone rely on keyword filters that get it wrong often: without AI, "the food was hot" counts as a suggestive message. The AI reviews those flagged messages and drops the ones that do not belong.',
      bullets: [
        'Only the messages that already passed the keyword filter are sent, trimmed and with a couple of context lines.',
        'No names travel: each participant shows up as a letter.',
        'The rest of the chat is still processed in your browser and never leaves your device.',
        'The result is stored once per chat: it is never analyzed — or billed — twice.',
      ],
      accept: 'Turn on and analyze',
      decline: 'Not now',
      working: 'Turning on...',
    },
    manageSubscription: 'Manage subscription',
    vipPopover: {
      eyebrow: 'Pro metrics',
      title: 'Unlock VIP',
      close: 'Close',
      signInPrompt: 'Sign in with Google to subscribe.',
      signInCta: 'Sign in',
    },
    subscriptionPage: {
      eyebrow: 'Account',
      title: 'Subscription',
      lead: 'Manage your Pro plan: benefits, billing, and cancellation.',
      backToApp: 'Back to Vistazo',
      signInPrompt: 'Sign in with Google to subscribe and see your account status.',
      signInCta: 'Sign in',
      close: 'Close',
      statuses: {
        pendiente: 'Payment pending',
        trial: 'Free trial',
        activa: 'Active',
        pago_fallido: 'Payment declined',
        pausada: 'Paused',
        cancelada: 'Cancelled',
        inactiva: 'No subscription',
      },
      statusHints: {
        pendiente: 'The payment has not been completed on Mercado Pago yet. You can pick it up any time.',
        trial: "You have full Pro access. Cancel before it ends and you won't be charged a thing.",
        activa: 'It renews automatically every month. You can cancel whenever you want.',
        pago_fallido: "We couldn't charge your card. Mercado Pago will retry; you keep access meanwhile.",
        pausada: 'No new charges will be made. You keep access until the paid period ends.',
        cancelada: "It won't renew. You keep access until the period you already paid for ends.",
        inactiva: "You don't have an active subscription.",
      },
      currentPlanTitle: 'Your plan',
      perMonth: 'per month',
      freeTrialBadge: '7 days free',
      trialEndsOn: 'Trial ends on',
      renewsOn: 'Next charge',
      endsOn: 'Access until',
      graceUntil: 'Access guaranteed until',
      paymentMethod: 'Payment method',
      startedOn: 'Started on',
      lastPayment: 'Last payment',
      cancelCta: 'Cancel renewal',
      cancelConfirmTitle: 'Cancel automatic renewal?',
      cancelConfirmBody:
        "You won't be charged again. You keep Pro access until {date}, and you can resubscribe any time.",
      cancelConfirmYes: 'Yes, cancel',
      cancelConfirmNo: 'Go back',
      refreshCta: 'Refresh status',
      refreshing: 'Refreshing...',
      cancelling: 'Cancelling...',
      billedBy: 'Automatic renewal',
      autoRenewOn: 'On',
      autoRenewOff: 'Off',
      adminNote: 'You have Pro access as an administrator, not through a paid subscription.',
      devNote: 'Subscription simulated from the local panel. It does not correspond to a real payment.',
      paymentsDisabled: 'Payments are not configured on the server yet.',
      plansTitle: 'Available plans',
      planName: 'Monthly plan',
      planDurationLabel: 'Duration',
      planDurationValue: 'Renews automatically every month',
      planAccessLabel: 'Access',
      planAccessValue: 'Every Pro metric, active as soon as the payment is confirmed',
      planTrialNote:
        "✨ Your first subscription includes a 7-day free trial. Cancel before it ends and you won't be charged anything.",
      planBenefitsLabel: "What's included",
      planBenefits: [
        'Red Flag Detector and Spicy Tone, verified with AI',
        'Sentiment, body clock, and every other Pro metric',
        'Full per-participant breakdown on every card',
        'Unlimited saved chat history',
      ],
      buyCta: 'Buy',
      buyTrialCta: 'Start with 7 days free',
      trialUnavailable: 'The free week has already been used.',
      trialReasons: {
        account_used: 'This account already took it.',
        ip_used: 'It was already used from this connection.',
        network_used: 'It was already used from this network.',
        device_used: 'It was already used from this device.',
        country_not_allowed: 'It is not available in your country.',
      },
      cardStepTitle: 'Payment method',
      cardStepBack: 'Back',
      cardCheckout: {
        missingKey: 'Payments are not configured on the server yet.',
        loading: 'Loading the payment form...',
        tokenMissing: 'Subscriptions only work with a credit or debit card for now — pick that option to continue.',
        securedBy: 'Payment securely processed by Mercado Pago',
      },
      submitting: 'Confirming with Mercado Pago...',
      genericError: "We couldn't process the payment. Please try again.",
      successTitle: "You're in!",
      successTrialBody: "Your free week just started. We'll warn you before the first charge.",
      successActiveBody: 'Your Pro subscription is now active.',
      successCta: 'Got it',
      invoicesTitle: 'Payment history',
      noInvoices: 'No charges recorded yet.',
      invoiceStatuses: {
        aprobado: 'Approved',
        rechazado: 'Declined',
        pendiente: 'Pending',
        reintentando: 'Retrying',
        devuelto: 'Refunded',
      },
      invoicePeriod: 'Period {from} — {to}',
      invoiceAttempt: 'Attempt {n}',
      historyTitle: 'Subscription history',
      noHistory: 'No subscriptions recorded yet.',
      eventsTitle: 'Account activity',
      noEvents: 'No activity recorded.',
    },
    dev: {
      badge: 'local',
      aiOn: 'AI on',
      aiOff: 'AI off',
      aiOnHint: 'AI metrics run when a chat is imported. Click to turn them off and stop spending tokens.',
      aiOffHint: 'The AI is not called when a chat is imported. Click to turn it back on.',
      vipOn: 'Activate subscription',
      vipOff: 'Deactivate subscription',
      vipHint: 'Simulates a Pro subscription without going through Mercado Pago.',
      signInFirst: 'Sign in to use this shortcut.',
      dragHint: 'Drag to move · double-click to snap back to the corner',
    },
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
      'Your messages are processed in your browser and the chat is never uploaded in full. We only store aggregated metrics once you sign in. With Pro, and only if you authorize it, two metrics send the messages already flagged by the keyword filter — trimmed and without names — for an AI to review.',
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
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
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
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

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
    setIsAccountMenuOpen(false)
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
    setIsAccountMenuOpen(false)
    setAiStates({})
    setSubscription(null)
    setSubscriptionError('')
    setIsVipPopoverOpen(false)
    aiAttemptedFor.current = ''
  }

  function openFilePicker() {
    fileInputRef.current?.click()
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

/** The same state for every AI-backed metric — used for the reasons that apply to all
 * of them at once (no key on the server, no consent, request never landed). */
function everyAiMetric(status: AiMetricStatus): AiCardStates {
  return Object.fromEntries(aiMetricIds.map((metricId) => [metricId, { status }])) as AiCardStates
}

/** The backend sends the subscription status as a plain string, while the copy tables are
 * `as const` literals — this is the widening step between the two. */
function translateStatus(statuses: Record<string, string>, status: string): string {
  return statuses[status] ?? status
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
