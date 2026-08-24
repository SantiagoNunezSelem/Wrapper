import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisCore } from '../metrics'

/**
 * Doble del `Worker` del navegador: jsdom no lo implementa, y lo que interesa probar
 * es el protocolo de mensajes del cliente (ids de request, progreso, errores y el
 * reintento con los mensajes cuando el worker perdió el chat de su caché), no el
 * worker en sí.
 */
class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  readonly posted: Record<string, unknown>[] = []

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: Record<string, unknown>) {
    this.posted.push(message)
  }

  terminate() {}

  /** Simula un mensaje del worker hacia el cliente. */
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }

  /** Id de request del último `postMessage`. */
  get lastRequestId(): number {
    return this.posted.at(-1)!.requestId as number
  }
}

const core = { chatName: 'Chat', sourceHash: 'abc' } as unknown as AnalysisCore

async function freshClient() {
  FakeWorker.instances.length = 0
  vi.resetModules()
  vi.stubGlobal('Worker', FakeWorker)
  return import('../analysisClient')
}

function worker() {
  return FakeWorker.instances[0]
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('analyzeInWorker', () => {
  it('manda el chat al worker y resuelve con el núcleo calculado', async () => {
    const { analyzeInWorker } = await freshClient()
    const pending = analyzeInWorker('Grupo', [], 'es', 'abc')

    expect(worker().posted[0]).toMatchObject({ type: 'analyze', chatName: 'Grupo', language: 'es', sourceHash: 'abc' })

    worker().reply({ requestId: worker().lastRequestId, type: 'analyze', core })
    await expect(pending).resolves.toBe(core)
  })

  it('reporta el progreso sin dar por terminada la request', async () => {
    const { analyzeInWorker } = await freshClient()
    const onProgress = vi.fn()
    const pending = analyzeInWorker('Grupo', [], 'es', 'abc', onProgress)
    const requestId = worker().lastRequestId

    worker().reply({ requestId, type: 'progress', completed: 3, total: 24 })
    worker().reply({ requestId, type: 'progress', completed: 24, total: 24 })
    expect(onProgress).toHaveBeenNthCalledWith(1, 3, 24)
    expect(onProgress).toHaveBeenNthCalledWith(2, 24, 24)

    worker().reply({ requestId, type: 'analyze', core })
    await expect(pending).resolves.toBe(core)
  })

  it('propaga el error que informa el worker', async () => {
    const { analyzeInWorker } = await freshClient()
    const pending = analyzeInWorker('Grupo', [], 'es', 'abc')

    worker().reply({ requestId: worker().lastRequestId, type: 'error', message: 'boom' })

    await expect(pending).rejects.toThrow('boom')
  })

  it('rechaza si el worker contesta otra cosa', async () => {
    const { analyzeInWorker } = await freshClient()
    const pending = analyzeInWorker('Grupo', [], 'es', 'abc')

    worker().reply({ requestId: worker().lastRequestId, type: 'aiCandidates', candidateSets: [] })

    await expect(pending).rejects.toThrow('Unexpected worker response for analyze.')
  })

  it('ignora una respuesta con un id de request desconocido', async () => {
    const { analyzeInWorker } = await freshClient()
    const pending = analyzeInWorker('Grupo', [], 'es', 'abc')

    worker().reply({ requestId: 999, type: 'error', message: 'de otra request' })
    worker().reply({ requestId: worker().lastRequestId, type: 'analyze', core })

    await expect(pending).resolves.toBe(core)
  })

  it('reutiliza el mismo worker y numera los pedidos', async () => {
    const { analyzeInWorker } = await freshClient()
    const first = analyzeInWorker('A', [], 'es', 'abc')
    const second = analyzeInWorker('B', [], 'es', 'abc')

    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker().posted.map((message) => message.requestId)).toEqual([0, 1])

    worker().reply({ requestId: 0, type: 'analyze', core })
    worker().reply({ requestId: 1, type: 'analyze', core })
    await expect(Promise.all([first, second])).resolves.toEqual([core, core])
  })

  it('un crash del worker rechaza todo lo pendiente en vez de colgarlo', async () => {
    const { analyzeInWorker } = await freshClient()
    const first = analyzeInWorker('A', [], 'es', 'abc')
    const second = analyzeInWorker('B', [], 'es', 'abc')

    worker().onerror?.({ message: 'worker roto' })

    await expect(first).rejects.toThrow('worker roto')
    await expect(second).rejects.toThrow('worker roto')
  })

  it('un crash sin mensaje usa un texto genérico', async () => {
    const { analyzeInWorker } = await freshClient()
    const pending = analyzeInWorker('A', [], 'es', 'abc')

    worker().onerror?.({ message: '' })

    await expect(pending).rejects.toThrow('Analysis worker crashed.')
  })
})

describe('buildAiCandidatesInWorker', () => {
  it('primero intenta sin reenviar los mensajes', async () => {
    const { buildAiCandidatesInWorker } = await freshClient()
    const pending = buildAiCandidatesInWorker('abc', [])

    expect(worker().posted[0]).toMatchObject({ type: 'aiCandidates', sourceHash: 'abc', messages: undefined })

    worker().reply({ requestId: 0, type: 'aiCandidates', candidateSets: [] })
    await expect(pending).resolves.toEqual([])
  })

  it('reenvía los mensajes cuando el worker perdió el chat de su caché', async () => {
    const { buildAiCandidatesInWorker } = await freshClient()
    const messages = [{ id: 'm1' }] as never
    const pending = buildAiCandidatesInWorker('abc', messages)

    worker().reply({ requestId: 0, type: 'cacheMiss' })
    await Promise.resolve()

    expect(worker().posted[1]).toMatchObject({ type: 'aiCandidates', sourceHash: 'abc', messages })

    worker().reply({ requestId: 1, type: 'aiCandidates', candidateSets: [{ metricId: 'redflags', candidates: [] }] })
    await expect(pending).resolves.toEqual([{ metricId: 'redflags', candidates: [] }])
  })

  it('rechaza si el worker contesta otra cosa', async () => {
    const { buildAiCandidatesInWorker } = await freshClient()
    const pending = buildAiCandidatesInWorker('abc', [])

    worker().reply({ requestId: 0, type: 'analyze', core })

    await expect(pending).rejects.toThrow('Unexpected worker response for aiCandidates.')
  })
})

describe('applyAiVerdictsInWorker', () => {
  it('manda el núcleo y los veredictos', async () => {
    const { applyAiVerdictsInWorker } = await freshClient()
    const pending = applyAiVerdictsInWorker(core, 'abc', 'es', [], { redflags: ['1', '2'] })

    expect(worker().posted[0]).toMatchObject({
      type: 'applyAi',
      sourceHash: 'abc',
      language: 'es',
      verdicts: { redflags: ['1', '2'] },
    })

    worker().reply({ requestId: 0, type: 'applyAi', core })
    await expect(pending).resolves.toBe(core)
  })

  it('reintenta con los mensajes ante un cacheMiss', async () => {
    const { applyAiVerdictsInWorker } = await freshClient()
    const messages = [{ id: 'm1' }] as never
    const pending = applyAiVerdictsInWorker(core, 'abc', 'es', messages, {})

    worker().reply({ requestId: 0, type: 'cacheMiss' })
    await Promise.resolve()

    expect(worker().posted[1]).toMatchObject({ messages })

    worker().reply({ requestId: 1, type: 'applyAi', core })
    await expect(pending).resolves.toBe(core)
  })

  it('rechaza si el worker contesta otra cosa', async () => {
    const { applyAiVerdictsInWorker } = await freshClient()
    const pending = applyAiVerdictsInWorker(core, 'abc', 'es', [], {})

    worker().reply({ requestId: 0, type: 'analyze', core })

    await expect(pending).rejects.toThrow('Unexpected worker response for applyAi.')
  })
})
