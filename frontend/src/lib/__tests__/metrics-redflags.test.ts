import { beforeEach, describe, expect, it } from 'vitest'
import { chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import type { BarDatum, MetricCard } from '../../types'
import { applyAiVerdicts, computeAnalysisCore, type AiMetricVerdict } from '../metrics'

beforeEach(resetMessageIds)

/**
 * Red Flags con lo que dijo la IA. Lo que se prueba es qué vale cada acierto del diccionario según
 * lo que la IA hizo con él: lo aceptado cuenta entero, lo rechazado desaparece, y lo que nadie
 * juzgó cuenta tanto como la IA acepta de lo parecido que sí miró. Más lo que la lectura encuentra
 * por su cuenta.
 */

const minute = (index: number) => `2025-03-10T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`

/** `count` insultos dirigidos ("sos un idiota número N"), de Ana, uno por minuto. */
function insults(count: number, from = 0): MessageSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    at: minute(from + index),
    from: 'Ana',
    text: `sos un idiota número ${index}`,
  }))
}

async function redflagsWith(messages: ReturnType<typeof chat>, verdict?: Partial<AiMetricVerdict>): Promise<MetricCard | undefined> {
  const core = await computeAnalysisCore('Chat', messages, 'es', 'hash')

  if (!verdict) {
    return core.rawVipMetrics.find((item) => item.id === 'redflags')
  }

  const applied = await applyAiVerdicts(core, messages, 'es', {
    redflags: { accepted: new Set(), rejected: new Set(), ...verdict },
  })
  return applied.rawVipMetrics.find((item) => item.id === 'redflags')
}

function bucketValues(card: MetricCard): Record<string, number> {
  const chart = card.basic?.chart
  const items: BarDatum[] = chart?.kind === 'bar' ? chart.items : []
  return Object.fromEntries(items.map((item) => [item.label, item.value]))
}

describe('Red Flags — lo que no se juzgó vale lo que la IA acepta de lo parecido', () => {
  it('con la mitad aceptada y la mitad rechazada, lo que nadie miró cuenta la mitad', async () => {
    const messages = chat(...insults(20))
    const ids = messages.map((message) => message.id)

    const card = await redflagsWith(messages, {
      accepted: new Set(ids.slice(0, 5)),
      rejected: new Set(ids.slice(5, 10)),
    })

    // 5 confirmados + 10 sin juzgar a razón de 5 de cada 10 = 10. Los 5 rechazados no cuentan.
    expect(card?.basic?.value).toBe('10')
    expect(card?.basic?.label).toBe('insultos')
  })

  it('sin revisión suficiente no se inventa una tasa: lo que nadie miró cuenta entero', async () => {
    const messages = chat(...insults(14))
    const ids = messages.map((message) => message.id)

    // 3 mirados (2 aceptados, 1 rechazado) no alcanzan para fiarse de una tasa.
    const card = await redflagsWith(messages, {
      accepted: new Set(ids.slice(0, 2)),
      rejected: new Set(ids.slice(2, 3)),
    })

    expect(card?.basic?.value).toBe('13')
  })

  it('una categoría sin revisar usa la tasa de todo el chat', async () => {
    const jealousy: MessageSpec[] = Array.from({ length: 10 }, (_, index) => ({
      at: minute(100 + index),
      from: 'Beto',
      text: `me dejaste en visto otra vez número ${index}`,
    }))
    const messages = chat(...insults(10), ...jealousy)
    const ids = messages.map((message) => message.id)

    // Se miraron 10 insultos y la IA aceptó 8 (80%); a los celos nadie los miró.
    const card = await redflagsWith(messages, {
      accepted: new Set(ids.slice(0, 8)),
      rejected: new Set(ids.slice(8, 10)),
    })

    expect(bucketValues(card!)).toEqual({ Insultos: 8, 'Celos y control': 8 })
  })

  it('la tasa de una categoría con revisión suficiente es la suya, no la del chat', async () => {
    const jealousy: MessageSpec[] = Array.from({ length: 10 }, (_, index) => ({
      at: minute(100 + index),
      from: 'Beto',
      text: `me dejaste en visto otra vez número ${index}`,
    }))
    const messages = chat(...insults(10), ...jealousy)
    const ids = messages.map((message) => message.id)

    // Insultos: 10 mirados, 9 aceptados. Celos: 6 mirados, 2 aceptados, 4 sin mirar → 2 + 4 / 3 ≈ 3.
    const card = await redflagsWith(messages, {
      accepted: new Set([...ids.slice(0, 9), ...ids.slice(10, 12)]),
      rejected: new Set([...ids.slice(9, 10), ...ids.slice(12, 16)]),
    })

    expect(bucketValues(card!)['Celos y control']).toBe(3)
    expect(bucketValues(card!).Insultos).toBe(9)
  })

  it('sin veredicto cada acierto cuenta entero, como antes', async () => {
    const card = await redflagsWith(chat(...insults(12)))

    expect(card?.basic?.value).toBe('12')
  })

  it('el reparto por integrante usa los mismos pesos', async () => {
    const mixed = chat(
      ...insults(10),
      ...Array.from({ length: 10 }, (_, index) => ({
        at: minute(50 + index),
        from: 'Beto',
        text: `sos un imbécil número ${index}`,
      })),
    )
    const ids = mixed.map((message) => message.id)

    // De los 10 de Ana se aceptan 10; de los 10 de Beto se rechazan 5 y se aceptan 5: pesan lo mismo.
    const card = await redflagsWith(mixed, {
      accepted: new Set([...ids.slice(0, 10), ...ids.slice(10, 15)]),
      rejected: new Set(ids.slice(15, 20)),
    })

    const breakdown = card?.detail?.breakdown ?? []
    expect(breakdown.map((entry) => entry.name)).toEqual(['Ana', 'Beto'])
    expect(breakdown[0].displayValue).toBe('66.7%')
    expect(breakdown[1].displayValue).toBe('33.3%')
  })
})

describe('Red Flags — lo que la lectura encuentra por su cuenta', () => {
  const quiet = (count: number): MessageSpec[] =>
    Array.from({ length: count }, (_, index) => ({ at: minute(index), from: index % 2 ? 'Ana' : 'Beto', text: `todo bien por acá ${index}` }))

  it('un mensaje sin ninguna frase del diccionario cuenta en la categoría que le puso la lectura', async () => {
    const messages = chat(...quiet(10), { at: minute(20), from: 'Ana', text: 'mirá cómo me dejás, así se paga todo lo que di' })
    const flagged = messages[messages.length - 1].id

    const card = await redflagsWith(messages, { found: new Map([[flagged, 'blackmail']]) })

    expect(bucketValues(card!)).toEqual({ 'Chantaje emocional': 1 })
    expect(card?.basic?.label).toBe('mensaje de chantaje')
    // Y es un ejemplo para leer, con su categoría en el título.
    const groups = card?.detail?.groups ?? []
    expect(groups).toHaveLength(1)
    expect(groups[0].heading).toBe('Ana — Chantaje emocional')
  })

  it('si la lectura lo pone en otra categoría, el acierto del diccionario deja la suya: un juicio, un conteo', async () => {
    const messages = chat(...quiet(6), { at: minute(20), from: 'Beto', text: 'sos un idiota' })
    const target = messages[messages.length - 1].id

    const before = await redflagsWith(messages)
    expect(bucketValues(before!)).toEqual({ Insultos: 1 })

    const card = await redflagsWith(messages, { found: new Map([[target, 'threats']]) })

    expect(bucketValues(card!)).toEqual({ Amenazas: 1 })
  })

  it('un mensaje que no existe en el chat se ignora', async () => {
    const messages = chat(...quiet(8), ...insults(3, 30))

    const card = await redflagsWith(messages, { found: new Map([['no-existe', 'gaslighting']]) })

    expect(bucketValues(card!)).toEqual({ Insultos: 3 })
  })

  it('lo encontrado y lo aceptado del diccionario se suman en una misma categoría', async () => {
    const messages = chat(...quiet(6), ...insults(2, 20), { at: minute(40), from: 'Beto', text: 'sos un desastre y siempre lo fuiste' })
    const ids = messages.map((message) => message.id)

    const card = await redflagsWith(messages, {
      accepted: new Set(ids.slice(6, 8)),
      found: new Map([[ids[8], 'insults']]),
    })

    expect(bucketValues(card!)).toEqual({ Insultos: 3 })
  })

  it('si el diccionario no encontró nada y la lectura sí, la tarjeta aparece, en su lugar de la lista', async () => {
    const messages = chat(...quiet(10), { at: minute(30), from: 'Ana', text: 'solo yo me importo de verdad, nadie más' })
    const flagged = messages[messages.length - 1].id

    const core = await computeAnalysisCore('Chat', messages, 'es', 'hash')
    // El diccionario no ve nada en este chat: no hay tarjeta de Red Flags.
    expect(core.rawVipMetrics.some((item) => item.id === 'redflags')).toBe(false)

    const applied = await applyAiVerdicts(core, messages, 'es', {
      redflags: { accepted: new Set(), rejected: new Set(), found: new Map([[flagged, 'isolation']]) },
    })

    const ids = applied.rawVipMetrics.map((item) => item.id)
    expect(ids).toContain('redflags')
    expect(bucketValues(applied.rawVipMetrics.find((item) => item.id === 'redflags')!)).toEqual({ Aislamiento: 1 })
    // Y en el lugar que le toca: antes de la métrica que le sigue en la lista Pro, no al final.
    expect(ids.indexOf('redflags')).toBeLessThan(ids.indexOf('rompehielo'))
  })

  it('un hallazgo no crea una tarjeta que ya existía ni toca a las demás', async () => {
    const messages = chat(...quiet(10), ...insults(3, 30))
    const core = await computeAnalysisCore('Chat', messages, 'es', 'hash')
    const flagged = messages[0].id

    const applied = await applyAiVerdicts(core, messages, 'es', {
      redflags: { accepted: new Set(), rejected: new Set(), found: new Map([[flagged, 'pressure']]) },
    })

    expect(applied.rawVipMetrics.map((item) => item.id)).toEqual(core.rawVipMetrics.map((item) => item.id))
    expect(applied.rawVipMetrics.filter((item) => item.id === 'redflags')).toHaveLength(1)
  })
})

describe('Red Flags — los ejemplos', () => {
  it('cuando hay más de los que entran, quedan los más recientes y se leen en orden de chat', async () => {
    const messages = chat(...insults(60))
    const card = await redflagsWith(messages, { accepted: new Set(messages.map((message) => message.id)) })

    const groups = card?.detail?.groups ?? []
    expect(groups).toHaveLength(50)

    const numbers = groups.map((group) => Number(/número (\d+)/.exec(group.bubbles.find((bubble) => bubble.isHighlight)!.text)![1]))
    // Se conservan del 10 al 59 (los 50 más nuevos) y se muestran del más viejo al más nuevo.
    expect(numbers[0]).toBe(10)
    expect(numbers.at(-1)).toBe(59)
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right))
  })
})

describe('Red Flags — las categorías de manipulación', () => {
  it('chantaje, gaslighting, aislamiento, amenazas y presión aparecen como categorías propias', async () => {
    const messages = chat(
      { at: minute(0), from: 'Ana', text: 'si me quisieras de verdad no te irías' },
      { at: minute(1), from: 'Beto', text: 'eso nunca pasó, te lo inventaste' },
      { at: minute(2), from: 'Ana', text: 'tus amigas no te quieren' },
      { at: minute(3), from: 'Beto', text: 'te voy a hacer pagar' },
      { at: minute(4), from: 'Ana', text: 'si me querés lo hacés' },
    )

    const card = await redflagsWith(messages)

    expect(bucketValues(card!)).toEqual({
      'Chantaje emocional': 1,
      Gaslighting: 1,
      Aislamiento: 1,
      Amenazas: 1,
      Presión: 1,
    })
  })

  it('en inglés también', async () => {
    const core = await computeAnalysisCore(
      'Chat',
      chat(
        { at: minute(0), from: 'Ana', text: "if you really loved me you wouldn't go" },
        { at: minute(1), from: 'Beto', text: "that never happened, you're imagining things" },
        { at: minute(2), from: 'Ana', text: "it's me or them" },
        { at: minute(3), from: 'Beto', text: "i'll make you pay for this" },
      ),
      'en',
      'hash',
    )

    const card = core.rawVipMetrics.find((item) => item.id === 'redflags')!
    expect(Object.keys(bucketValues(card)).sort()).toEqual(['Emotional blackmail', 'Gaslighting', 'Isolation', 'Threats'])
  })

  it('un insulto estirado o con la última letra duplicada también se cuenta', async () => {
    const card = await redflagsWith(
      chat(
        { at: minute(0), from: 'Ana', text: 'sos un pelotudooooo' },
        { at: minute(1), from: 'Beto', text: 'IDIOTAAAA' },
        { at: minute(2), from: 'Ana', text: 'sos re boludoo' },
        { at: minute(3), from: 'Beto', text: 'sos un hdp' },
      ),
    )

    expect(bucketValues(card!).Insultos).toBe(4)
  })
})
