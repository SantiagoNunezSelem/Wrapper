import type { ChatMessage, Language } from '../types'
import { buildAllAiCandidates, type AiCandidateSet } from './aiCandidates'
import { applyAiVerdicts, computeAnalysisCore, type AiMetricId, type AiVerdicts, type AnalysisCore } from './metrics'

export type WorkerRequest =
  | {
      requestId: number
      type: 'analyze'
      chatName: string
      messages: ChatMessage[]
      language: Language
      sourceHash: string
    }
  | { requestId: number; type: 'aiCandidates'; sourceHash: string; messages?: ChatMessage[] }
  | {
      requestId: number
      type: 'applyAi'
      sourceHash: string
      language: Language
      core: AnalysisCore
      verdicts: Partial<Record<AiMetricId, string[]>>
      messages?: ChatMessage[]
    }

export type WorkerResponse =
  | { requestId: number; type: 'analyze'; core: AnalysisCore }
  | { requestId: number; type: 'aiCandidates'; candidateSets: AiCandidateSet[] }
  | { requestId: number; type: 'applyAi'; core: AnalysisCore }
  /** The worker no longer holds this chat's messages — the client should resend them. */
  | { requestId: number; type: 'cacheMiss' }
  | { requestId: number; type: 'error'; message: string }

// Typed as a plain object instead of relying on the "webworker" lib: this project's
// tsconfig already targets "DOM" for the main thread, and layering "webworker" on
// top of that in the same program redeclares globals (self, postMessage, onmessage)
// with incompatible signatures.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

/**
 * The messages of the chat currently on screen. Keeping them here means the AI passes
 * — building candidates, then re-deriving the metrics from the verdicts — don't have
 * to ship 85k messages across the worker boundary again for each step. Only one chat
 * is held: the AI phase always follows the analysis of the same upload.
 */
let cached: { sourceHash: string; messages: ChatMessage[] } | null = null

function messagesFor(sourceHash: string, provided?: ChatMessage[]): ChatMessage[] | null {
  if (provided) {
    cached = { sourceHash, messages: provided }
    return provided
  }

  return cached?.sourceHash === sourceHash ? cached.messages : null
}

workerScope.onmessage = (event) => {
  const request = event.data

  void handle(request)
    .then((response) => workerScope.postMessage(response))
    .catch((error: unknown) =>
      workerScope.postMessage({
        requestId: request.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  const { requestId } = request

  if (request.type === 'analyze') {
    cached = { sourceHash: request.sourceHash, messages: request.messages }

    const core = await computeAnalysisCore(
      request.chatName,
      request.messages,
      request.language,
      request.sourceHash,
    )

    return { requestId, type: 'analyze', core }
  }

  if (request.type === 'aiCandidates') {
    const messages = messagesFor(request.sourceHash, request.messages)

    if (!messages) {
      return { requestId, type: 'cacheMiss' }
    }

    return { requestId, type: 'aiCandidates', candidateSets: buildAllAiCandidates(messages) }
  }

  const messages = messagesFor(request.sourceHash, request.messages)

  if (!messages) {
    return { requestId, type: 'cacheMiss' }
  }

  const verdicts: AiVerdicts = {}
  for (const [metricId, acceptedIds] of Object.entries(request.verdicts)) {
    verdicts[metricId as AiMetricId] = new Set(acceptedIds)
  }

  const core = await applyAiVerdicts(request.core, messages, request.language, verdicts)
  return { requestId, type: 'applyAi', core }
}
