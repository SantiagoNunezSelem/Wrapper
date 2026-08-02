import type { ChatMessage, Language } from '../types'
import type { AnalysisCore } from './metrics'
import type { AnalyzeRequest, AnalyzeResponse } from './analysisWorker'

// One worker for the app's whole lifetime — analysis requests are infrequent
// (upload, language toggle) and serialized by the caller, so a pool would add
// complexity with no real benefit.
let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, { resolve: (core: AnalysisCore) => void; reject: (error: Error) => void }>()

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

  worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
    const { requestId } = event.data
    const request = pending.get(requestId)
    if (!request) {
      return
    }
    pending.delete(requestId)

    if (event.data.type === 'success') {
      request.resolve(event.data.core)
    } else {
      request.reject(new Error(event.data.message))
    }
  }

  worker.onerror = (event) => {
    // Fires for load-time failures (e.g. a bug in the worker bundle) that never
    // reach onmessage — without this, those requests would hang forever.
    rejectAllPending(event.message || 'Analysis worker crashed.')
  }

  return worker
}

/** Runs the expensive metric computation on a background thread so the main
 * thread — and the loading overlay's spinner — never freezes, no matter how
 * large the chat is. */
export function analyzeInWorker(
  chatName: string,
  messages: ChatMessage[],
  language: Language,
  sourceHash: string,
): Promise<AnalysisCore> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId
    nextRequestId += 1
    pending.set(requestId, { resolve, reject })
    getWorker().postMessage({ requestId, chatName, messages, language, sourceHash } satisfies AnalyzeRequest)
  })
}
