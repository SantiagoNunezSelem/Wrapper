import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, resetMessageIds } from '../../test/fixtures'
import type { WorkerRequest, WorkerResponse } from '../analysisWorker'

/**
 * El worker se instala sobre `self` al importarse (`self.onmessage = ...`). En jsdom
 * `self` es `window`, así que alcanza con espiar `postMessage` y con recargar el módulo
 * en cada test — importante, porque el worker cachea el último chat a nivel de módulo y
 * ese caché es justamente una de las cosas a probar.
 */
async function bootWorker() {
  vi.resetModules()
  const posted: WorkerResponse[] = []
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as WorkerResponse)
  })

  await import('../analysisWorker')

  async function send(request: WorkerRequest) {
    ;(window as unknown as { onmessage: (event: { data: WorkerRequest }) => void }).onmessage({ data: request })
    // El handler es async: se le da margen a la cadena de promesas (una por métrica).
    for (let tick = 0; tick < 80; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (posted.some((message) => message.requestId === request.requestId && message.type !== 'progress')) {
        break
      }
    }
    return posted.filter((message) => message.requestId === request.requestId)
  }

  return { send, posted }
}

const messages = chat(
  { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola jaja que sexy' },
  { at: '2025-03-10T10:01:00', from: 'Beto', text: 'me dejaste en visto ayer' },
)

beforeEach(resetMessageIds)

describe('analysisWorker', () => {
  it('analiza un chat y devuelve el núcleo', async () => {
    const { send } = await bootWorker()

    const replies = await send({ requestId: 1, type: 'analyze', chatName: 'Grupo', messages, language: 'es', sourceHash: 'abc' })
    const final = replies.at(-1)!

    expect(final.type).toBe('analyze')
    expect(final.type === 'analyze' && final.core.chatName).toBe('Grupo')
    expect(final.type === 'analyze' && final.core.messageCount).toBe(2)
  })

  it('emite progreso antes de la respuesta final', async () => {
    const { send } = await bootWorker()

    const replies = await send({ requestId: 1, type: 'analyze', chatName: 'Grupo', messages, language: 'es', sourceHash: 'abc' })
    const progress = replies.filter((message) => message.type === 'progress')

    expect(progress.length).toBe(24)
    expect(progress[0]).toEqual({ requestId: 1, type: 'progress', completed: 1, total: 24 })
    expect(replies.at(-1)!.type).toBe('analyze')
  })

  it('avisa cacheMiss cuando le piden candidatos de un chat que nunca vio', async () => {
    const { send } = await bootWorker()

    const [reply] = await send({ requestId: 1, type: 'aiCandidates', sourceHash: 'desconocido' })

    expect(reply.type).toBe('cacheMiss')
  })

  it('reusa el chat del análisis para construir los candidatos', async () => {
    const { send } = await bootWorker()
    await send({ requestId: 1, type: 'analyze', chatName: 'Grupo', messages, language: 'es', sourceHash: 'abc' })

    const [reply] = await send({ requestId: 2, type: 'aiCandidates', sourceHash: 'abc' })

    expect(reply.type).toBe('aiCandidates')
    expect(reply.type === 'aiCandidates' && reply.candidateSets.map((set) => set.metricId)).toEqual([
      'tonopicante',
      'redflags',
    ])
  })

  it('acepta que le reenvíen los mensajes y los vuelve a cachear', async () => {
    const { send } = await bootWorker()

    const [first] = await send({ requestId: 1, type: 'aiCandidates', sourceHash: 'abc', messages })
    expect(first.type).toBe('aiCandidates')

    const [second] = await send({ requestId: 2, type: 'aiCandidates', sourceHash: 'abc' })
    expect(second.type).toBe('aiCandidates')
  })

  it('sólo guarda un chat: pedir por otro hash es cacheMiss', async () => {
    const { send } = await bootWorker()
    await send({ requestId: 1, type: 'analyze', chatName: 'A', messages, language: 'es', sourceHash: 'abc' })
    await send({ requestId: 2, type: 'analyze', chatName: 'B', messages, language: 'es', sourceHash: 'def' })

    const [reply] = await send({ requestId: 3, type: 'aiCandidates', sourceHash: 'abc' })

    expect(reply.type).toBe('cacheMiss')
  })

  it('aplica los veredictos sobre el núcleo que le pasan', async () => {
    const { send } = await bootWorker()
    const analyzed = await send({ requestId: 1, type: 'analyze', chatName: 'Grupo', messages, language: 'es', sourceHash: 'abc' })
    const core = analyzed.at(-1)!
    if (core.type !== 'analyze') {
      throw new Error('Se esperaba una respuesta de análisis.')
    }

    const [reply] = await send({
      requestId: 2,
      type: 'applyAi',
      sourceHash: 'abc',
      language: 'es',
      core: core.core,
      verdicts: { tonopicante: [messages[0].id] },
    })

    expect(reply.type).toBe('applyAi')
  })

  it('applyAi también responde cacheMiss sin el chat', async () => {
    const { send } = await bootWorker()

    const [reply] = await send({
      requestId: 1,
      type: 'applyAi',
      sourceHash: 'abc',
      language: 'es',
      core: { rawVipMetrics: [] } as never,
      verdicts: {},
    })

    expect(reply.type).toBe('cacheMiss')
  })

  it('cuenta una palabra buscada en todo el chat y por cada participante', async () => {
    const { send } = await bootWorker()

    const [reply] = await send({ requestId: 1, type: 'wordSearch', messages, query: 'jaja', participants: ['Ana', 'Beto'] })

    expect(reply.type).toBe('wordSearch')
    expect(reply.type === 'wordSearch' && reply.count).toBe(1)
    expect(reply.type === 'wordSearch' && reply.countsByParticipant).toEqual({ Ana: 1, Beto: 0 })
  })

  it('convierte una excepción en un mensaje de error, no en un worker muerto', async () => {
    const { send } = await bootWorker()

    // `messages` sin definir hace que `computeAnalysisCore` explote al filtrar.
    const [reply] = await send({
      requestId: 1,
      type: 'analyze',
      chatName: 'Grupo',
      messages: undefined as never,
      language: 'es',
      sourceHash: 'abc',
    })

    expect(reply.type).toBe('error')
    expect(reply.type === 'error' && reply.message).toBeTruthy()
  })
})
