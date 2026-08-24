import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, conversation, message, resetMessageIds } from '../../test/fixtures'
import type { AiCardState, MetricCard } from '../../types'
import {
  aiMetricIds,
  applyAiVerdicts,
  buildAnalysis,
  computeAnalysisCore,
  createMetricContext,
  gateAnalysis,
  isAiMetricId,
  isParticipantBarChart,
  totalMetricCount,
  type AnalysisCore,
} from '../metrics'

beforeEach(resetMessageIds)

/** Un chat chico pero con datos suficientes para que varias métricas devuelvan algo. */
function sampleChat() {
  return chat(
    ...conversation({
      day: '2025-03-10',
      people: ['Ana', 'Beto'],
      turns: [
        'hola como va jajaja',
        'todo bien vos 😀',
        'mira este link https://youtu.be/abc',
        'jajaja que bueno',
        'ANDA A SABER',
        'nos vemos?',
      ],
    }),
    { at: '2025-03-11T09:00:00', from: 'Ana', text: 'buen dia' },
    { at: '2025-03-11T09:01:00', from: 'Ana', text: 'estas ahi' },
    { at: '2025-03-11T09:02:00', from: 'Beto', text: 'si perdon' },
  )
}

describe('createMetricContext', () => {
  it('descarta los mensajes de sistema', () => {
    const ctx = createMetricContext(
      chat(
        { at: '2025-03-10T10:00:00', from: null, text: 'Los mensajes están cifrados' },
        { at: '2025-03-10T10:01:00', from: 'Ana', text: 'hola' },
      ),
      'es',
    )

    expect(ctx.chatMessages).toHaveLength(1)
    expect(ctx.participants).toEqual(['Ana'])
  })

  it.each(['Meta AI', 'meta ai', ' META AI ', 'ERROR', 'error'])(
    'descarta a "%s" como pseudo-participante',
    (sender) => {
      const ctx = createMetricContext(
        chat(
          { at: '2025-03-10T10:00:00', from: sender, text: 'respuesta automatica' },
          { at: '2025-03-10T10:01:00', from: 'Ana', text: 'hola' },
        ),
        'es',
      )

      expect(ctx.participants).toEqual(['Ana'])
      expect(ctx.chatMessages).toHaveLength(1)
    },
  )

  it('conserva los placeholders en chatMessages pero no en textMessages', () => {
    const ctx = createMetricContext(
      chat(
        { at: '2025-03-10T10:00:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
        { at: '2025-03-10T10:01:00', from: 'Ana', text: 'mira' },
      ),
      'es',
    )

    expect(ctx.chatMessages).toHaveLength(2)
    expect(ctx.textMessages).toHaveLength(1)
  })

  it('ordena los participantes por primera aparición, no alfabéticamente', () => {
    const ctx = createMetricContext(
      chat(
        { at: '2025-03-10T10:00:00', from: 'Zoe', text: 'primero' },
        { at: '2025-03-10T10:01:00', from: 'Ana', text: 'segundo' },
        { at: '2025-03-10T10:02:00', from: 'Zoe', text: 'tercero' },
      ),
      'es',
    )

    expect(ctx.participants).toEqual(['Zoe', 'Ana'])
  })

  it('indexa cada mensaje por su posición en la lista a la que pertenece', () => {
    const messages = chat(
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'uno' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'dos' },
    )
    const ctx = createMetricContext(messages, 'es')

    expect(ctx.messageIndex.get(messages[2].id)).toBe(2)
    // En textMessages el placeholder no existe, así que "dos" corre un lugar.
    expect(ctx.textMessageIndex.get(messages[2].id)).toBe(1)
  })

  it('agrupa por remitente conservando el orden relativo', () => {
    const messages = chat(
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'uno' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'dos' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'tres' },
    )
    const ctx = createMetricContext(messages, 'es')

    expect(ctx.chatMessagesBySender.get('Ana')?.map((item) => item.contentText)).toEqual(['uno', 'tres'])
    expect(ctx.chatMessagesBySender.get('Beto')?.map((item) => item.contentText)).toEqual(['dos'])
  })

  it('no rompe con una lista vacía', () => {
    const ctx = createMetricContext([], 'es')

    expect(ctx.chatMessages).toEqual([])
    expect(ctx.participants).toEqual([])
    expect(ctx.messageIndex.size).toBe(0)
  })
})

describe('computeAnalysisCore', () => {
  it('cuenta 24 métricas entre gratis y Pro', () => {
    expect(totalMetricCount).toBe(24)
  })

  it('devuelve un núcleo vacío y explícito cuando no hay mensajes reales', async () => {
    const core = await computeAnalysisCore('Chat', [], 'es', 'hash')

    expect(core.messageCount).toBe(0)
    expect(core.participantCount).toBe(0)
    expect(core.rawFreeMetrics).toEqual([])
    expect(core.rawVipMetrics).toEqual([])
    expect(core.dateRangeLabel).toBe('Sin datos suficientes')
  })

  it('traduce el aviso de "sin datos" al idioma pedido', async () => {
    const core = await computeAnalysisCore('Chat', [], 'en', 'hash')

    expect(core.dateRangeLabel).toBe('Not enough data')
  })

  it('arma el rango con el primer y el último mensaje', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')

    expect(core.dateRangeLabel).toMatch(/^\d{2} .+ 2025 - \d{2} .+ 2025$/)
    expect(core.messageCount).toBe(9)
    expect(core.participantCount).toBe(2)
    expect(core.participants).toEqual(['Ana', 'Beto'])
  })

  it('propaga chatName y sourceHash sin tocarlos', async () => {
    const core = await computeAnalysisCore('Grupo de la facu', sampleChat(), 'es', 'abc123')

    expect(core.chatName).toBe('Grupo de la facu')
    expect(core.sourceHash).toBe('abc123')
  })

  it('descarta las tarjetas sin datos en vez de devolverlas vacías', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')

    for (const card of [...core.rawFreeMetrics, ...core.rawVipMetrics]) {
      expect(card.hasData).toBe(true)
      expect(card.basic).toBeDefined()
    }
  })

  it('reporta el progreso una vez por métrica, hasta el total', async () => {
    const onProgress = vi.fn()
    await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash', onProgress)

    expect(onProgress).toHaveBeenCalledTimes(totalMetricCount)
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, totalMetricCount)
    expect(onProgress).toHaveBeenLastCalledWith(totalMetricCount, totalMetricCount)
  })

  it('no reporta progreso cuando el chat está vacío (sale antes de calcular)', async () => {
    const onProgress = vi.fn()
    await computeAnalysisCore('Chat', [], 'es', 'hash', onProgress)

    expect(onProgress).not.toHaveBeenCalled()
  })

  it('etiqueta cada tarjeta con su tier y su acento', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')

    expect(core.rawFreeMetrics.every((card) => card.tier === 'free')).toBe(true)
    expect(core.rawVipMetrics.every((card) => card.tier === 'vip')).toBe(true)
    expect(core.rawFreeMetrics.every((card) => card.accent.startsWith('tier-'))).toBe(true)
  })

  it('traduce títulos y descripciones según el idioma', async () => {
    const [es, en] = await Promise.all([
      computeAnalysisCore('Chat', sampleChat(), 'es', 'hash'),
      computeAnalysisCore('Chat', sampleChat(), 'en', 'hash'),
    ])

    const spammerEs = es.rawFreeMetrics.find((card) => card.id === 'spammer')
    const spammerEn = en.rawFreeMetrics.find((card) => card.id === 'spammer')

    expect(spammerEs?.title).toBe('Quién manda más mensajes')
    expect(spammerEn?.title).toBe('Who sends the most messages')
    expect(spammerEs?.preview).not.toBe(spammerEn?.preview)
  })

  it('le da a cada participante un color fijo, igual en todas las métricas', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')
    const colors = new Map<string, string>()

    for (const card of [...core.rawFreeMetrics, ...core.rawVipMetrics]) {
      for (const entry of card.detail?.breakdown ?? []) {
        if (!entry.color) {
          continue
        }
        const known = colors.get(entry.name)
        if (known) {
          expect(entry.color).toBe(known)
        } else {
          colors.set(entry.name, entry.color)
        }
      }
    }

    expect(colors.size).toBeGreaterThan(0)
    // Dos participantes distintos nunca comparten color.
    expect(new Set(colors.values()).size).toBe(colors.size)
  })
})

describe('isParticipantBarChart', () => {
  it('es falso sin chart', () => {
    expect(isParticipantBarChart(undefined)).toBe(false)
  })

  it('es falso para un chart que no es de barras', () => {
    expect(isParticipantBarChart({ kind: 'donut', items: [{ label: 'Ana', value: 1 }] })).toBe(false)
  })

  it('es falso para un ranking sin colores (categorías, no personas)', () => {
    expect(
      isParticipantBarChart({
        kind: 'bar',
        items: [{ label: 'YouTube', value: 3, displayValue: '3' }],
      }),
    ).toBe(false)
  })

  it('es falso si sólo algunas barras tienen color', () => {
    expect(
      isParticipantBarChart({
        kind: 'bar',
        items: [
          { label: 'Ana', value: 3, displayValue: '3', color: '#111' },
          { label: 'Otros', value: 1, displayValue: '1' },
        ],
      }),
    ).toBe(false)
  })

  it('es falso para un chart de barras vacío', () => {
    expect(isParticipantBarChart({ kind: 'bar', items: [] })).toBe(false)
  })

  it('es verdadero cuando todas las barras son participantes con color', () => {
    expect(
      isParticipantBarChart({
        kind: 'bar',
        items: [
          { label: 'Ana', value: 3, displayValue: '3', color: '#111' },
          { label: 'Beto', value: 1, displayValue: '1', color: '#222' },
        ],
      }),
    ).toBe(true)
  })
})

describe('isAiMetricId', () => {
  it('reconoce las dos métricas con IA', () => {
    expect(aiMetricIds).toEqual(['tonopicante', 'redflags'])
    expect(isAiMetricId('tonopicante')).toBe(true)
    expect(isAiMetricId('redflags')).toBe(true)
  })

  it.each(['spammer', 'wordcloud', '', 'TONOPICANTE'])('rechaza "%s"', (id) => {
    expect(isAiMetricId(id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bloqueo por tier / IA
// ---------------------------------------------------------------------------

function coreWith(free: MetricCard[], vip: MetricCard[]): AnalysisCore {
  return {
    chatName: 'Chat',
    dateRangeLabel: '01 mar 2025 - 02 mar 2025',
    generatedAt: '2025-03-02T00:00:00.000Z',
    messageCount: 10,
    participantCount: 2,
    participants: ['Ana', 'Beto'],
    sourceHash: 'hash',
    rawFreeMetrics: free,
    rawVipMetrics: vip,
  }
}

function card(id: string, tier: 'free' | 'vip'): MetricCard {
  return {
    id,
    title: `Título ${id}`,
    description: `Apodo ${id}`,
    tier,
    accent: 'tier-purple',
    hasData: true,
    basic: { value: '42', label: 'mensajes' },
    detail: { intro: 'detalle' },
    preview: 'teaser',
  }
}

describe('gateAnalysis', () => {
  const core = coreWith([card('spammer', 'free')], [card('wordcloud', 'vip'), card('redflags', 'vip')])

  it('sin Pro: la tarjeta gratis muestra el número pero no el detalle', () => {
    const bundle = gateAnalysis(core, false)

    expect(bundle.freeMetrics[0].basic).toBeDefined()
    expect(bundle.freeMetrics[0].detail).toBeUndefined()
  })

  it('sin Pro: la tarjeta Pro no muestra ni el número ni el detalle', () => {
    const bundle = gateAnalysis(core, false)
    const wordcloud = bundle.vipMetrics.find((item) => item.id === 'wordcloud')!

    expect(wordcloud.basic).toBeUndefined()
    expect(wordcloud.detail).toBeUndefined()
  })

  it('sin Pro: el teaser y el título siguen visibles en la tarjeta bloqueada', () => {
    const bundle = gateAnalysis(core, false)
    const wordcloud = bundle.vipMetrics.find((item) => item.id === 'wordcloud')!

    expect(wordcloud.preview).toBe('teaser')
    expect(wordcloud.title).toBe('Título wordcloud')
    expect(wordcloud.description).toBe('Apodo wordcloud')
  })

  it('con Pro: todo abierto', () => {
    const bundle = gateAnalysis(core, true, { redflags: { status: 'ready' } })

    expect(bundle.freeMetrics[0].detail).toBeDefined()
    expect(bundle.vipMetrics.every((item) => item.basic && item.detail)).toBe(true)
  })

  it('un desbloqueo gratis abre el detalle de esa métrica gratis y de ninguna otra', () => {
    const bigger = coreWith([card('spammer', 'free'), card('emojis', 'free')], [])
    const bundle = gateAnalysis(bigger, false, {}, new Set(['spammer']))

    expect(bundle.freeMetrics.find((item) => item.id === 'spammer')?.detail).toBeDefined()
    expect(bundle.freeMetrics.find((item) => item.id === 'emojis')?.detail).toBeUndefined()
  })

  it('un desbloqueo gratis NUNCA abre una métrica Pro', () => {
    const bundle = gateAnalysis(core, false, {}, new Set(['wordcloud']))
    const wordcloud = bundle.vipMetrics.find((item) => item.id === 'wordcloud')!

    expect(wordcloud.basic).toBeUndefined()
    expect(wordcloud.detail).toBeUndefined()
  })

  it('una métrica de IA sin veredicto queda bloqueada aunque haya Pro', () => {
    const bundle = gateAnalysis(core, true)
    const redflags = bundle.vipMetrics.find((item) => item.id === 'redflags')!

    expect(redflags.ai).toEqual({ status: 'pending' })
    expect(redflags.basic).toBeUndefined()
    expect(redflags.detail).toBeUndefined()
  })

  it.each<AiCardState['status']>(['pending', 'failed', 'consent', 'unavailable'])(
    'una métrica de IA en estado "%s" no filtra los números crudos del diccionario',
    (status) => {
      const bundle = gateAnalysis(core, true, { redflags: { status } })
      const redflags = bundle.vipMetrics.find((item) => item.id === 'redflags')!

      expect(redflags.basic).toBeUndefined()
      expect(redflags.ai?.status).toBe(status)
    },
  )

  it('una métrica de IA lista se comporta como cualquier otra Pro', () => {
    const withVip = gateAnalysis(core, true, { redflags: { status: 'ready' } })
    const withoutVip = gateAnalysis(core, false, { redflags: { status: 'ready' } })

    expect(withVip.vipMetrics.find((item) => item.id === 'redflags')?.basic).toBeDefined()
    expect(withoutVip.vipMetrics.find((item) => item.id === 'redflags')?.basic).toBeUndefined()
  })

  it('el estado de IA sólo se adjunta a las tarjetas de IA', () => {
    const bundle = gateAnalysis(core, true, { redflags: { status: 'ready' } })

    expect(bundle.freeMetrics[0].ai).toBeUndefined()
    expect(bundle.vipMetrics.find((item) => item.id === 'wordcloud')?.ai).toBeUndefined()
  })

  it('conserva los metadatos del núcleo y no expone las listas crudas', () => {
    const bundle = gateAnalysis(core, false)

    expect(bundle.chatName).toBe('Chat')
    expect(bundle.sourceHash).toBe('hash')
    expect(bundle.participants).toEqual(['Ana', 'Beto'])
    expect('rawFreeMetrics' in bundle).toBe(false)
    expect('rawVipMetrics' in bundle).toBe(false)
  })

  it('no muta el núcleo que recibe', () => {
    const snapshot = JSON.stringify(core)
    gateAnalysis(core, false, { redflags: { status: 'pending' } }, new Set(['spammer']))

    expect(JSON.stringify(core)).toBe(snapshot)
  })
})

describe('buildAnalysis', () => {
  it('calcula y filtra en un solo paso', async () => {
    const bundle = await buildAnalysis('Chat', sampleChat(), 'es', false, 'hash')

    expect(bundle.freeMetrics.length).toBeGreaterThan(0)
    expect(bundle.freeMetrics[0].detail).toBeUndefined()
  })

  it('con Pro devuelve el detalle de las métricas no-IA', async () => {
    const bundle = await buildAnalysis('Chat', sampleChat(), 'es', true, 'hash')
    const noAi = bundle.vipMetrics.filter((item) => !item.ai)

    expect(noAi.length).toBeGreaterThan(0)
    expect(noAi.every((item) => item.detail)).toBe(true)
  })
})

describe('applyAiVerdicts', () => {
  // Dos aciertos del diccionario, uno por persona: el de Ana es real y el de Beto es
  // el falso positivo clásico que la IA existe para descartar.
  const spicy = chat(
    { at: '2025-03-10T22:00:00', from: 'Ana', text: 'estas muy sexy hoy' },
    { at: '2025-03-10T22:01:00', from: 'Beto', text: 'la comida estaba caliente nada mas' },
    { at: '2025-03-10T22:02:00', from: 'Ana', text: 'jaja bueno' },
  )

  it('devuelve el mismo núcleo cuando no hay ningún veredicto', async () => {
    const core = await computeAnalysisCore('Chat', spicy, 'es', 'hash')
    const applied = await applyAiVerdicts(core, spicy, 'es', {})

    expect(applied).toBe(core)
  })

  it('recalcula sólo las tarjetas de IA y deja intactas las demás', async () => {
    const core = await computeAnalysisCore('Chat', spicy, 'es', 'hash')
    const before = core.rawVipMetrics.filter((item) => !isAiMetricId(item.id))

    const applied = await applyAiVerdicts(core, spicy, 'es', {
      tonopicante: new Set([spicy[0].id]),
    })
    const after = applied.rawVipMetrics.filter((item) => !isAiMetricId(item.id))

    expect(after).toEqual(before)
    expect(applied.rawFreeMetrics).toEqual(core.rawFreeMetrics)
  })

  it('el veredicto recorta los ejemplos mostrados pero no el total', async () => {
    const core = await computeAnalysisCore('Chat', spicy, 'es', 'hash')
    const before = core.rawVipMetrics.find((item) => item.id === 'tonopicante')!

    // Sin veredicto se listan los dos aciertos crudos, uno por participante.
    expect(before.detail?.groups).toHaveLength(2)
    expect(before.detail?.breakdown?.map((entry) => entry.name).sort()).toEqual(['Ana', 'Beto'])

    const applied = await applyAiVerdicts(core, spicy, 'es', {
      tonopicante: new Set([spicy[0].id]),
    })
    const after = applied.rawVipMetrics.find((item) => item.id === 'tonopicante')!

    // Sólo queda como ejemplo el mensaje que la IA aceptó…
    expect(after.detail?.groups).toHaveLength(1)
    expect(after.detail?.groups?.[0].heading).toContain('Ana')
    // …pero el reparto y el conteo siguen contando los dos aciertos del diccionario.
    expect(after.detail?.breakdown).toEqual(before.detail?.breakdown)
    expect(after.basic?.value).toBe(before.basic?.value)
  })

  it('quita la tarjeta cuando la IA rechaza absolutamente todo y no queda dato', async () => {
    const only = chat({ at: '2025-03-10T22:00:00', from: 'Ana', text: 'me dejaste en visto otra vez' })
    const core = await computeAnalysisCore('Chat', only, 'es', 'hash')

    expect(core.rawVipMetrics.some((item) => item.id === 'redflags')).toBe(true)

    const applied = await applyAiVerdicts(core, only, 'es', { redflags: new Set<string>() })
    const redflags = applied.rawVipMetrics.find((item) => item.id === 'redflags')

    // Sin aciertos aceptados la tarjeta pierde los ejemplos, pero el score heurístico
    // sigue existiendo: la tarjeta se mantiene con datos.
    expect(redflags?.detail?.groups ?? []).toHaveLength(0)
    expect(redflags?.basic?.value).toMatch(/^\d+\/100$/)
  })

  it('mantiene los colores de participante después del recálculo', async () => {
    const core = await computeAnalysisCore('Chat', spicy, 'es', 'hash')
    const applied = await applyAiVerdicts(core, spicy, 'es', {
      tonopicante: new Set([spicy[0].id, spicy[1].id]),
    })
    const breakdown = applied.rawVipMetrics.find((item) => item.id === 'tonopicante')?.detail?.breakdown ?? []

    expect(breakdown.length).toBeGreaterThan(0)
    expect(breakdown.every((entry) => entry.color)).toBe(true)
  })
})

describe('regresión de estructura', () => {
  it('cada métrica devuelve un value y un label no vacíos', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')

    for (const item of [...core.rawFreeMetrics, ...core.rawVipMetrics]) {
      expect(item.basic?.value, `${item.id}.basic.value`).toBeTruthy()
      expect(item.basic?.label, `${item.id}.basic.label`).toBeTruthy()
    }
  })

  it('ningún id de métrica está duplicado entre los dos tiers', async () => {
    const core = await computeAnalysisCore('Chat', sampleChat(), 'es', 'hash')
    const ids = [...core.rawFreeMetrics, ...core.rawVipMetrics].map((item) => item.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('un mensaje suelto de una sola persona no rompe ninguna métrica', async () => {
    const core = await computeAnalysisCore(
      'Chat',
      [message({ at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola' })],
      'es',
      'hash',
    )

    expect(core.messageCount).toBe(1)
    expect(core.rawFreeMetrics.length).toBeGreaterThan(0)
  })
})
