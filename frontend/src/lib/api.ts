import type { AuthResponse, SavedAnalysis, UserProfile } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5175'

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
    throw new Error(text || `Request failed with status ${response.status}`)
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
