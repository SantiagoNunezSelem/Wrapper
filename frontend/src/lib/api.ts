import type {
  AiMetricState,
  AuthResponse,
  CheckoutStart,
  FreeUnlockState,
  SavedAnalysis,
  SubscriptionOverview,
  UserProfile,
} from '../types'
import { getDeviceId } from './deviceId'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5175'

/** Carries the machine-readable `code` the API sends alongside a rejection (e.g.
 * `pro_required`, `consent_required`) so callers can branch without matching on prose. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text
    let code: string | undefined

    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string }
      message = parsed.message ?? text
      code = parsed.code
    } catch {
      // Not every failure comes back as JSON (proxies, 502s) — keep the raw text.
    }

    throw new ApiError(message || `Request failed with status ${response.status}`, response.status, code)
  }

  return (await response.json()) as T
}

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>(
    '/api/auth/google',
    {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    },
  )
}

export async function getCurrentUser(token: string): Promise<UserProfile> {
  return request<UserProfile>('/api/auth/me', { method: 'GET' }, token)
}

export async function listAnalyses(token: string): Promise<SavedAnalysis[]> {
  return request<SavedAnalysis[]>('/api/analyses', { method: 'GET' }, token)
}

/** One filtered fragment of chat, as built by `aiCandidates.ts`. */
export interface AiSnippetPayload {
  id: string
  keyword: string
  text: string
}

interface AiMetricsEnvelope {
  results: AiMetricState[]
}

/**
 * Asks the backend to run the AI-backed metrics. It only calls Google for metrics
 * with no stored verdict and outside their retry cooldown, so re-running this is
 * cheap by design; every rejection path (no Pro, no consent) costs zero tokens.
 */
export async function analyzeAiMetrics(
  token: string,
  payload: {
    sourceHash: string
    metrics: { metricId: string; snippets: AiSnippetPayload[] }[]
  },
): Promise<AiMetricState[]> {
  const response = await request<AiMetricsEnvelope>(
    '/api/ai/metrics',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )

  return response.results
}

/** Re-runs every metric of this chat that is currently failed, reusing the snippets
 * the backend stored on the first attempt. */
export async function retryAiMetrics(token: string, sourceHash: string): Promise<AiMetricState[]> {
  const response = await request<AiMetricsEnvelope>(
    '/api/ai/metrics/retry',
    {
      method: 'POST',
      body: JSON.stringify({ sourceHash }),
    },
    token,
  )

  return response.results
}

/** Reads stored verdicts without triggering any AI call. */
export async function getAiMetrics(token: string, sourceHash: string): Promise<AiMetricState[]> {
  const response = await request<AiMetricsEnvelope>(
    `/api/ai/metrics?sourceHash=${encodeURIComponent(sourceHash)}`,
    { method: 'GET' },
    token,
  )

  return response.results
}

export async function grantAiConsent(token: string): Promise<UserProfile> {
  return request<UserProfile>('/api/ai/consent', { method: 'POST' }, token)
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Everything the account screen needs in one call: current plan, entitlement, trial
 * eligibility, billing history and the audit trail.
 *
 * The device id travels with it because trial eligibility is part of the answer — the
 * screen has to know whether to offer "7 días gratis" or go straight to the paid price.
 */
export async function getSubscription(token: string): Promise<SubscriptionOverview> {
  return request<SubscriptionOverview>(
    `/api/subscription?deviceId=${encodeURIComponent(getDeviceId())}`,
    { method: 'GET' },
    token,
  )
}

/**
 * Opens a checkout and hands back Mercado Pago's own hosted page — the card form, 3-D
 * Secure if the bank asks for it, all of it happens over there, not in this app. The
 * caller's whole job with the result is `window.location.href = initPoint`; whether the
 * subscription actually goes through is unknown here, and shows up later once the payer
 * is sent back (see `syncSubscription`) or the webhook lands.
 */
export async function startCheckout(token: string): Promise<CheckoutStart> {
  const response = await request<{ initPoint: string; subscriptionId: string }>(
    '/api/subscription/checkout',
    {
      method: 'POST',
      body: JSON.stringify({ deviceId: getDeviceId() }),
    },
    token,
  )

  return { initPoint: response.initPoint, subscriptionId: response.subscriptionId }
}

/** Stops automatic renewal. Access continues until the end of the paid period. */
export async function cancelSubscription(token: string): Promise<SubscriptionOverview> {
  return request<SubscriptionOverview>('/api/subscription/cancel', { method: 'POST' }, token)
}

/** Re-reads the subscription from Mercado Pago. Used on return from checkout, where the
 * redirect normally beats the webhook, and as a manual "no aparece mi pago" escape. */
export async function syncSubscription(token: string): Promise<SubscriptionOverview> {
  return request<SubscriptionOverview>('/api/subscription/sync', { method: 'POST' }, token)
}

// ---------------------------------------------------------------------------
// Free daily metric unlocks
// ---------------------------------------------------------------------------

/**
 * Today's free-unlock allowance for the signed-in account, plus what it already bought
 * on `sourceHash`. Omitting the chat still answers how many are left today, just with an
 * empty unlock list.
 */
export async function getFreeUnlocks(token: string, sourceHash?: string): Promise<FreeUnlockState> {
  const query = sourceHash ? `?sourceHash=${encodeURIComponent(sourceHash)}` : ''
  return request<FreeUnlockState>(`/api/metric-unlocks${query}`, { method: 'GET' }, token)
}

/**
 * Spends one of the day's free unlocks on a free-tier metric, for one chat, and hands
 * back the allowance as it stands afterwards.
 *
 * Idempotent per (chat, metric, day), so re-asking for something already unlocked on
 * that chat is free — while the same metric on a different export is a separate unlock.
 * Rejections carry a `code`: `daily_limit_reached`, `vip_metric` (a Pro metric can never
 * be bought this way), `source_hash_required` or `vip_active`.
 */
export async function spendFreeUnlock(
  token: string,
  metricId: string,
  sourceHash: string,
): Promise<FreeUnlockState> {
  return request<FreeUnlockState>(
    '/api/metric-unlocks',
    {
      method: 'POST',
      body: JSON.stringify({ metricId, sourceHash }),
    },
    token,
  )
}

/** Local dev only; the backend refuses this outside Development + loopback. */
export async function toggleDevSubscription(token: string): Promise<{ simulatedSubscriptionActive: boolean }> {
  return request<{ simulatedSubscriptionActive: boolean }>(
    '/api/dev/subscription/toggle',
    { method: 'POST' },
    token,
  )
}

/** Local dev only: hands today's free unlocks back so the flow can be walked again.
 * Clears every chat's; `sourceHash` only picks which chat the reply describes. */
export async function resetDevFreeUnlocks(token: string, sourceHash?: string): Promise<FreeUnlockState> {
  const query = sourceHash ? `?sourceHash=${encodeURIComponent(sourceHash)}` : ''
  return request<FreeUnlockState>(`/api/dev/free-unlocks/reset${query}`, { method: 'POST' }, token)
}

export async function saveAnalysis(
  token: string,
  payload: {
    chatName: string
    dateRangeLabel: string
    messageCount: number
    participantCount: number
    resultsJson: string
    sourceHash: string
  },
): Promise<SavedAnalysis> {
  return request<SavedAnalysis>(
    '/api/analyses',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}
