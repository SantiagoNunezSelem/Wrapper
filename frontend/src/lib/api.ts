import type { AiMetricState, AuthResponse, SavedAnalysis, UserProfile } from '../types'

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
