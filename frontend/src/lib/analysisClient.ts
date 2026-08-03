import type { ChatMessage, Language } from '../types'
import type { AiCandidateSet } from './aiCandidates'
import type { AiMetricId, AnalysisCore } from './metrics'
import type { WorkerRequest, WorkerResponse } from './analysisWorker'

// One worker for the app's whole lifetime — analysis requests are infrequent
// (upload, language toggle, AI pass) and serialized by the caller, so a pool would
// add complexity with no real benefit.
let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<
  number,
  {
    resolve: (response: WorkerResponse) => void
    reject: (error: Error) => void
    /** Only set for `analyze` calls — fires on every `progress` message and never
     * removes the request from `pending`, since more messages (and the final
     * response) for the same `requestId` are still coming. */
    onProgress?: (completed: number, total: number) => void
  }
>()

function rejectAllPending(message: string) {
  for (const [requestId, request] of pending) {
    request.reject(new Error(message))
    pending.delete(requestId)
  }
}

function getWorker(): Worker {
  if (worker) {
    return worker
  }

  worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { requestId } = event.data
    const request = pending.get(requestId)
    if (!request) {
      return
    }

    if (event.data.type === 'progress') {
      request.onProgress?.(event.data.completed, event.data.total)
      return
    }

    pending.delete(requestId)

    if (event.data.type === 'error') {
      request.reject(new Error(event.data.message))
    } else {
      request.resolve(event.data)
    }
  }

  worker.onerror = (event) => {
    // Fires for load-time failures (e.g. a bug in the worker bundle) that never
    // reach onmessage — without this, those requests would hang forever.
    rejectAllPending(event.message || 'Analysis worker crashed.')
  }

  return worker
}

/** A plain `Omit` over a union collapses it to the keys they share, which would drop
 * every per-operation field. Distributing keeps each variant intact. */
type WorkerRequestInput = WorkerRequest extends infer Variant
  ? Variant extends WorkerRequest
    ? Omit<Variant, 'requestId'>
    : never
  : never

function send(request: WorkerRequestInput, onProgress?: (completed: number, total: number) => void): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId
    nextRequestId += 1
    pending.set(requestId, { resolve, reject, onProgress })
    getWorker().postMessage({ ...request, requestId } as WorkerRequest)
  })
}

/** Runs the expensive metric computation on a background thread so the main
 * thread — and the loading overlay's spinner — never freezes, no matter how
 * large the chat is. `onProgress` fires once per metric as it finishes, for the
 * analyzing screen's progress bar. */
export async function analyzeInWorker(
  chatName: string,
  messages: ChatMessage[],
  language: Language,
  sourceHash: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<AnalysisCore> {
  const response = await send({ type: 'analyze', chatName, messages, language, sourceHash }, onProgress)

  if (response.type !== 'analyze') {
    throw new Error('Unexpected worker response for analyze.')
  }

  return response.core
}

/**
 * Builds the filtered snippets for the AI-backed metrics. Runs in the worker for the
 * same reason the analysis does: it walks every message and normalizes each one, which
 * is seconds of work on a large chat.
 */
export async function buildAiCandidatesInWorker(
  sourceHash: string,
  messages: ChatMessage[],
): Promise<AiCandidateSet[]> {
  const response = await withMessageRetry(
    (withMessages) => send({ type: 'aiCandidates', sourceHash, messages: withMessages ? messages : undefined }),
  )

  if (response.type !== 'aiCandidates') {
    throw new Error('Unexpected worker response for aiCandidates.')
  }

  return response.candidateSets
}

/** Re-derives the AI-backed cards from the model's verdicts, leaving the rest of the
 * core untouched. */
export async function applyAiVerdictsInWorker(
  core: AnalysisCore,
  sourceHash: string,
  language: Language,
  messages: ChatMessage[],
  verdicts: Partial<Record<AiMetricId, string[]>>,
): Promise<AnalysisCore> {
  const response = await withMessageRetry((withMessages) =>
    send({
      type: 'applyAi',
      sourceHash,
      language,
      core,
      verdicts,
      messages: withMessages ? messages : undefined,
    }),
  )

  if (response.type !== 'applyAi') {
    throw new Error('Unexpected worker response for applyAi.')
  }

  return response.core
}

/**
 * The worker normally still holds the chat from the initial analysis, so the AI passes
 * cost nothing to set up. If it doesn't — a crash, or a language switch that rebuilt
 * the core elsewhere — it says so and we pay the one-off transfer instead of failing.
 */
async function withMessageRetry(
  attempt: (withMessages: boolean) => Promise<WorkerResponse>,
): Promise<WorkerResponse> {
  const first = await attempt(false)
  return first.type === 'cacheMiss' ? attempt(true) : first
}
