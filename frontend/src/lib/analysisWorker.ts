import { computeAnalysisCore, type AnalysisCore } from './metrics'
import type { ChatMessage, Language } from '../types'

export interface AnalyzeRequest {
  requestId: number
  chatName: string
  messages: ChatMessage[]
  language: Language
  sourceHash: string
}

export type AnalyzeResponse =
  | { requestId: number; type: 'success'; core: AnalysisCore }
  | { requestId: number; type: 'error'; message: string }

// Typed as a plain object instead of relying on the "webworker" lib: this project's
// tsconfig already targets "DOM" for the main thread, and layering "webworker" on
// top of that in the same program redeclares globals (self, postMessage, onmessage)
// with incompatible signatures.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalyzeRequest>) => void) | null
  postMessage: (message: AnalyzeResponse) => void
}

workerScope.onmessage = (event) => {
  const { requestId, chatName, messages, language, sourceHash } = event.data

  computeAnalysisCore(chatName, messages, language, sourceHash)
    .then((core) => workerScope.postMessage({ requestId, type: 'success', core }))
    .catch((error: unknown) =>
      workerScope.postMessage({
        requestId,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
}
