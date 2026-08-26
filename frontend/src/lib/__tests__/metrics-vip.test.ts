import { beforeEach, describe, expect, it } from 'vitest'
import { burst, chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import type { BarDatum, Language, MetricCard } from '../../types'
import { computeAnalysisCore, countWordOccurrences } from '../metrics'

beforeEach(resetMessageIds)

async function vipMetric(id: string, specs: MessageSpec[], language: Language = 'es') {
  const core = await computeAnalysisCore('Chat', chat(...specs), language, 'hash')
  return core.rawVipMetrics.find((card) => card.id === id)
}

async function requireVipMetric(id: string, specs: MessageSpec[], language: Language = 'es') {
  const card = await vipMetric(id, specs, language)
  if (!card) {
    throw new Error(`La métrica "${id}" no devolvió datos para este chat.`)
  }
  return card
}

function bars(card: MetricCard, where: 'basic' | 'detail' = 'basic'): BarDatum[] {
  const chartData = where === 'basic' ? card.basic?.chart : card.detail?.chart
  if (chartData?.kind !== 'bar') {
    throw new Error(`Se esperaba un chart de barras en ${where}, llegó ${chartData?.kind}`)
  }
  return chartData.items
}

/**
 * Relleno inocuo, para diluir los puntajes que se calculan por tasa.
 *
 * Arranca la víspera del día que usan los tests: si quedara semanas atrás, el hueco
 * hasta el mensaje bajo prueba contaría como "silencio largo" y sumaría al puntaje de
 * red flags, que es justo lo que estos tests intentan aislar.
 */
function filler(count: number, from = 'Ana'): MessageSpec[] {
  return burst({ at: '2025-03-09T10:00:00', from, count, stepMinutes: 1, text: () => 'todo bien por aca' })
}

// ---------------------------------------------------------------------------
// El Clavavistos
// ---------------------------------------------------------------------------

describe('métrica clavavistos', () => {
  it('mide el promedio de respuesta del más lento', async () => {
    const card = await requireVipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola como estas' },
      { at: '2025-03-10T12:00:00', from: 'Beto', text: 'perdon recien veo' },
      { at: '2025-03-10T12:05:00', from: 'Ana', text: 'no pasa nada dale' },
    ])

    // Beto tardó 120 minutos; Ana, 5.
    expect(card.basic?.value).toBe('2.0 horas')
    expect(card.basic?.label).toBe('tiempo promedio de respuesta de Beto')
  })

  it('sólo cuenta como espera un mensaje con pregunta o de 3+ palabras', async () => {
    const card = await vipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'ok' },
      { at: '2025-03-10T12:00:00', from: 'Beto', text: 'dale' },
    ])

    expect(card).toBeUndefined()
  })

  it('un "ok?" corto sí cuenta como espera, por la pregunta', async () => {
    const card = await requireVipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'ok?' },
      { at: '2025-03-10T10:30:00', from: 'Beto', text: 'si' },
    ])

    expect(card.basic?.value).toBe('30.0 minutos')
  })

  it('un audio sin responder cuenta como espera; un texto vacío no', async () => {
    const withAudio = await vipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
      { at: '2025-03-10T11:00:00', from: 'Beto', text: 'ya escucho' },
    ])
    const withDeleted = await vipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'Se eliminó este mensaje', isPlaceholder: true, isDeleted: true },
      { at: '2025-03-10T11:00:00', from: 'Beto', text: 'que dijiste' },
    ])

    expect(withAudio).toBeDefined()
    expect(withDeleted).toBeUndefined()
  })

  it('no cuenta dos mensajes seguidos de la misma persona', async () => {
    const card = await vipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola como estas' },
      { at: '2025-03-10T14:00:00', from: 'Ana', text: 'seguis ahi o que' },
    ])

    expect(card).toBeUndefined()
  })

  it.each([
    [45, '45.0 minutos'],
    [90, '1.5 horas'],
    [60 * 36, '1.5 días'],
  ])('formatea una demora de %i minutos como "%s"', async (minutes, expected) => {
    const end = new Date(new Date('2025-03-10T10:00:00').getTime() + minutes * 60_000)
    const pad = (value: number) => String(value).padStart(2, '0')
    const at = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`

    const card = await requireVipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola como estas' },
      { at, from: 'Beto', text: 'perdon' },
    ])

    expect(card.basic?.value).toBe(expected)
  })

  it('anota la peor demora del chat en la nota', async () => {
    const card = await requireVipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola como estas' },
      { at: '2025-03-12T10:00:00', from: 'Beto', text: 'perdon recien veo' },
    ])

    expect(card.basic?.note).toBe('Peor demora: Beto tardó 2.0 días.')
  })

  it('el detalle ordena las demoras de peor a mejor', async () => {
    const card = await requireVipMetric('clavavistos', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'primera pregunta?' },
      { at: '2025-03-10T10:10:00', from: 'Beto', text: 'respuesta rapida' },
      { at: '2025-03-10T10:20:00', from: 'Ana', text: 'segunda pregunta?' },
      { at: '2025-03-10T14:20:00', from: 'Beto', text: 'respuesta lenta' },
    ])

    expect(card.detail?.groups?.[0].heading).toBe('Beto tardó 4.0 horas en responder')
    expect(card.detail?.groups?.[1].heading).toBe('Beto tardó 10.0 minutos en responder')
    expect(card.detail?.paginatedItemsLabel).toBe('Peores demoras')
  })
})

// ---------------------------------------------------------------------------
// Rachas de Inactividad
// ---------------------------------------------------------------------------

describe('métrica inactividad', () => {
  it('mide el silencio más largo', async () => {
    const card = await requireVipMetric('inactividad', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-05T10:00:00', from: 'Beto', text: 'volvi' },
    ])

    expect(card.basic?.value).toBe('4.0 días')
    expect(card.basic?.label).toBe('fue el silencio más largo del chat')
  })

  it('expresa en horas los silencios de menos de un día', async () => {
    const card = await requireVipMetric('inactividad', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-01T18:00:00', from: 'Beto', text: 'hola' },
    ])

    expect(card.basic?.value).toBe('8.0 horas')
  })

  it('sólo lista como "silencio largo" los huecos de 48 horas o más', async () => {
    const card = await requireVipMetric('inactividad', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-02T10:00:00', from: 'Beto', text: '24 horas, no cuenta' },
      { at: '2025-03-05T10:00:00', from: 'Ana', text: '72 horas, si cuenta' },
    ])

    expect(card.detail?.groups).toHaveLength(1)
    expect(card.detail?.groups?.[0].heading).toBe('Silencio de 3.0 días — retomó Ana')
  })

  it('reparte quién rompió el hielo cada vez', async () => {
    const card = await requireVipMetric('inactividad', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-05T10:00:00', from: 'Beto', text: 'volvi' },
      { at: '2025-03-10T10:00:00', from: 'Beto', text: 'otra vez yo' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Beto', value: 2, displayValue: '100.0%', color: expect.any(String) },
    ])
  })

  it('sin silencios largos no dibuja timeline ni desglose', async () => {
    const card = await requireVipMetric('inactividad', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-01T11:00:00', from: 'Beto', text: 'hola' },
    ])

    expect(card.detail?.chart).toBeUndefined()
    expect(card.detail?.breakdown).toBeUndefined()
    expect(card.detail?.groups).toEqual([])
  })

  it('con un solo mensaje no hay hueco que medir', async () => {
    expect(
      await vipMetric('inactividad', [{ at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' }]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Nube de Palabras
// ---------------------------------------------------------------------------

describe('métrica wordcloud', () => {
  it('elige la palabra suelta más repetida', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado asado asado cerveza' },
    ])

    expect(card.basic?.value).toBe('asado')
    expect(card.basic?.label).toBe('la palabra más repetida (3 veces)')
  })

  it('descarta las palabras de menos de 3 letras', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'ok ok ok ok asado' },
    ])

    expect(card.basic?.value).toBe('asado')
  })

  it('descarta las palabras gramaticales', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'para para para para asado' },
    ])

    expect(card.basic?.value).toBe('asado')
  })

  it('saca los links enteros en vez de trocearlos', async () => {
    const card = await vipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'https://www.instagram.com/reel/xyz/?igsh=abc' },
    ])

    // Sin palabras reales, no queda nube.
    expect(card).toBeUndefined()
  })

  it('mezcla combinaciones de 2 y 3 palabras que se repiten', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado del domingo' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'asado del domingo' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'asado del domingo' },
    ])

    if (card.basic?.chart?.kind !== 'wordCloud') {
      throw new Error('Se esperaba una nube de palabras.')
    }
    const words = card.basic.chart.words.map((entry) => entry.word)
    expect(words).toContain('asado del domingo')
    expect(words).toContain('asado')
  })

  it('no cuenta como combinación una frase que apareció una sola vez', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado del domingo pasado' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'asado asado' },
    ])

    if (card.basic?.chart?.kind !== 'wordCloud') {
      throw new Error('Se esperaba una nube de palabras.')
    }
    expect(card.basic.chart.words.map((entry) => entry.word)).not.toContain('asado del domingo')
  })

  it('tope la nube en 40 entradas', async () => {
    const text = Array.from({ length: 80 }, (_, index) => `palabra${index}`).join(' ')
    const card = await requireVipMetric('wordcloud', [{ at: '2025-03-10T10:00:00', from: 'Ana', text }])

    if (card.basic?.chart?.kind !== 'wordCloud') {
      throw new Error('Se esperaba una nube de palabras.')
    }
    expect(card.basic.chart.words).toHaveLength(40)
  })

  it('da una nube propia a cada participante que aportó palabras', async () => {
    const card = await requireVipMetric('wordcloud', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado asado' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'de la' },
    ])

    expect(card.detail?.series?.map((entry) => entry.name)).toEqual(['Ana'])
  })
})

// ---------------------------------------------------------------------------
// Búsqueda manual en la nube: cuenta cualquier palabra del chat, no sólo las
// que ya están entre las 40 que muestra la nube (ver countWordOccurrences).
// ---------------------------------------------------------------------------

describe('countWordOccurrences', () => {
  it('cuenta una palabra corta o gramatical que la nube descartaría', () => {
    const messages = chat(
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'ok ok dale' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'ok, va' },
    )

    expect(countWordOccurrences(messages, 'ok')).toBe(3)
  })

  it('no distingue mayúsculas ni el signo de puntuación pegado', () => {
    const messages = chat({ at: '2025-03-10T10:00:00', from: 'Ana', text: 'Pizza! pizza? PIZZA.' })

    expect(countWordOccurrences(messages, 'pizza')).toBe(3)
  })

  it('cuenta una frase sólo donde las palabras aparecen seguidas', () => {
    const messages = chat(
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'buenos dias a todos' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'dias buenos, raro orden' },
    )

    expect(countWordOccurrences(messages, 'buenos dias')).toBe(1)
  })

  it('una palabra que nunca se dijo da cero', () => {
    const messages = chat({ at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado asado' })

    expect(countWordOccurrences(messages, 'inexistente')).toBe(0)
  })

  it('una búsqueda vacía da cero sin recorrer nada', () => {
    const messages = chat({ at: '2025-03-10T10:00:00', from: 'Ana', text: 'asado asado' })

    expect(countWordOccurrences(messages, '   ')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Detector de Red Flags
// ---------------------------------------------------------------------------

describe('métrica redflags', () => {
  it('puntúa de 0 a 100 y nunca se pasa', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'me dejaste en visto otra vez' },
    ])

    expect(card.basic?.value).toBe('100/100')
    expect(card.basic?.label).toBe('puntuación heurística de tensión')
  })

  it('el puntaje es una tasa: el mismo acierto pesa menos en un chat largo', async () => {
    const card = await requireVipMetric('redflags', [
      ...filler(99),
      { at: '2025-03-10T10:00:00', from: 'Beto', text: 'me dejaste en visto otra vez' },
    ])

    // 1 acierto de peso 4 sobre 100 mensajes: (4/100)*550 = 22.
    expect(card.basic?.value).toBe('22/100')
  })

  it('pondera cada categoría con su peso', async () => {
    const insult = await requireVipMetric('redflags', [
      ...filler(99),
      { at: '2025-03-10T10:00:00', from: 'Beto', text: 'sos un pelotudo' },
    ])

    // Insultos pesa 5: (5/100)*550 = 27.5 → 28.
    expect(insult.basic?.value).toBe('28/100')
  })

  it('los borrados suman al puntaje aunque no haya ninguna palabra clave', async () => {
    const card = await requireVipMetric('redflags', [
      ...filler(90),
      ...Array.from({ length: 10 }, (_, index) => ({
        at: `2025-03-10T10:${String(index).padStart(2, '0')}:00`,
        from: 'Beto',
        text: 'Se eliminó este mensaje',
        isDeleted: true,
      })),
    ])

    // 10 borrados sobre 100 mensajes: (10/100)*180 = 18.
    expect(card.basic?.value).toBe('18/100')
  })

  it('los silencios de 48h+ suman al puntaje', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-01T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-05T10:00:00', from: 'Beto', text: 'hola' },
    ])

    // 1 silencio largo: 1.8 → 2.
    expect(card.basic?.value).toBe('2/100')
  })

  it('sin aciertos, sin borrados y sin silencios no hay tarjeta', async () => {
    expect(
      await vipMetric('redflags', [
        { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que lindo dia' },
        { at: '2025-03-10T10:01:00', from: 'Beto', text: 'si buenisimo' },
      ]),
    ).toBeUndefined()
  })

  it('el gráfico rotula cada categoría con su nombre', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'estas celoso otra vez' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'sos un pelotudo' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'Se eliminó este mensaje', isDeleted: true },
    ])

    const labels = bars(card).map((item) => item.label)
    expect(labels).toContain('Celos y control')
    expect(labels).toContain('Insultos')
    expect(labels).toContain('Borrados')
  })

  it('traduce los nombres de categoría al inglés', async () => {
    const card = await requireVipMetric(
      'redflags',
      [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'you are so jealous' }],
      'en',
    )

    expect(bars(card).map((item) => item.label)).toContain('Jealousy & control')
  })

  it('un borrado no produce un ejemplo con texto (no hay nada que citar)', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'Se eliminó este mensaje', isDeleted: true },
    ])

    expect(card.detail?.groups).toEqual([])
    expect(bars(card).map((item) => item.label)).toEqual(['Borrados'])
  })

  it('los ejemplos van en orden cronológico, no por categoría', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'sos un pelotudo' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'estas celoso' },
    ])

    expect(card.detail?.groups?.[0].heading).toContain('Ana')
    expect(card.detail?.groups?.[1].heading).toContain('Beto')
  })

  it('el aviso deja claro que no es un diagnóstico', async () => {
    const card = await requireVipMetric('redflags', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'estas celoso' },
    ])

    expect(card.detail?.intro).toContain('No es un diagnóstico')
  })

  it('no cuenta una palabra clave que es parte de otra palabra', async () => {
    expect(
      await vipMetric('redflags', [
        { at: '2025-03-10T10:00:00', from: 'Ana', text: 'compramos un celoso... digo, un celofan' },
      ]),
    ).toBeDefined()

    // "celo" suelto no está en el diccionario; "celofan" no debe disparar "celos".
    expect(
      await vipMetric('redflags', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'traeme celofan' }]),
    ).toBeUndefined()
  })

  it('reconoce las palabras aunque vengan sin tildes', async () => {
    const withAccent = await vipMetric('redflags', [
      ...filler(99),
      { at: '2025-03-10T10:00:00', from: 'Beto', text: 'sos un manipulador' },
    ])
    const withoutAccent = await vipMetric('redflags', [
      ...filler(99),
      { at: '2025-03-10T10:00:00', from: 'Beto', text: 'que manipulación' },
    ])

    expect(withAccent?.basic?.value).toBeDefined()
    expect(withoutAccent?.basic?.value).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// El Rompehielo
// ---------------------------------------------------------------------------

describe('métrica rompehielo', () => {
  it('mide el porcentaje de días que abre cada uno', async () => {
    const card = await requireVipMetric('rompehielo', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'buen dia' },
      { at: '2025-03-11T10:00:00', from: 'Ana', text: 'buen dia' },
      { at: '2025-03-12T10:00:00', from: 'Beto', text: 'buen dia' },
      { at: '2025-03-13T10:00:00', from: 'Ana', text: 'buen dia' },
    ])

    expect(card.basic?.value).toBe('75.0%')
    expect(card.basic?.label).toBe('de los días los abre Ana')
  })

  it('no cuenta como apertura un mensaje pegado al anterior', async () => {
    // 06:30 cruza el corte de las 6am y abre un día conversacional nuevo, pero la
    // charla venía activa una hora antes: no es una apertura genuina.
    const card = await requireVipMetric('rompehielo', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-11T05:30:00', from: 'Ana', text: 'sigo despierto' },
      { at: '2025-03-11T06:30:00', from: 'Beto', text: 'seguis?' },
    ])

    // Sólo la primera línea del chat cuenta como apertura.
    expect(card.detail?.groups).toHaveLength(1)
    expect(card.basic?.value).toBe('100.0%')
  })

  it('sí cuenta como apertura tras 3 horas de silencio en un día nuevo', async () => {
    const card = await requireVipMetric('rompehielo', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-11T09:00:00', from: 'Beto', text: 'buen dia' },
    ])

    expect(card.detail?.groups).toHaveLength(2)
  })

  it('lista las aperturas de la más reciente a la más vieja', async () => {
    const card = await requireVipMetric('rompehielo', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'primera' },
      { at: '2025-03-11T10:00:00', from: 'Beto', text: 'segunda' },
    ])

    expect(card.detail?.groups?.[0].heading).toContain('Beto')
    expect(card.detail?.paginatedItemsLabel).toBe('Aperturas de conversación')
  })

  it('el gráfico principal es un donut', async () => {
    const card = await requireVipMetric('rompehielo', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-11T10:00:00', from: 'Beto', text: 'hola' },
    ])

    expect(card.basic?.chart?.kind).toBe('donut')
  })
})

// ---------------------------------------------------------------------------
// El Mes Más Intenso
// ---------------------------------------------------------------------------

describe('métrica top-dias', () => {
  it('encuentra el día pico', async () => {
    const card = await requireVipMetric('top-dias', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 7 }),
      ...burst({ at: '2025-03-11T10:00:00', from: 'Ana', count: 2 }),
    ])

    expect(card.basic?.value).toBe('7')
    expect(card.basic?.label).toContain('mensajes el')
  })

  it('el ranking del detalle se corta en 10 días', async () => {
    const specs = Array.from({ length: 15 }, (_, index) => ({
      at: `2025-03-${String(index + 1).padStart(2, '0')}T10:00:00`,
      from: 'Ana',
      text: 'hola',
    }))
    const card = await requireVipMetric('top-dias', specs)

    expect(bars(card, 'detail')).toHaveLength(10)
  })

  it('el desglose muestra quién empujó el día pico', async () => {
    const card = await requireVipMetric('top-dias', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-10T15:00:00', from: 'Beto', text: 'uno' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 5, displayValue: '5', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '1', color: expect.any(String) },
    ])
  })

  it('cada día pico trae un fragmento real de la conversación', async () => {
    const card = await requireVipMetric('top-dias', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 }),
    ])

    expect(card.detail?.groups?.[0].bubbles.length).toBeGreaterThan(0)
    expect(card.detail?.paginatedItemsLabel).toBe('Fragmentos de los días pico')
  })
})

// ---------------------------------------------------------------------------
// El Metralleta
// ---------------------------------------------------------------------------

describe('métrica metralleta', () => {
  /** N mensajes de 1-2 palabras separados por 5 segundos. */
  function rapidFire(from: string, count: number, startAt = '2025-03-10T10:00:00'): MessageSpec[] {
    const start = new Date(startAt).getTime()
    return Array.from({ length: count }, (_, index) => ({
      at: new Date(start + index * 5_000).toISOString(),
      from,
      text: 'dale',
    }))
  }

  it('cuenta la ráfaga más grande de micro-mensajes', async () => {
    const card = await requireVipMetric('metralleta', rapidFire('Ana', 5))

    expect(card.basic?.value).toBe('5')
    expect(card.basic?.label).toBe('micro-mensajes seguidos de Ana en menos de 10s')
  })

  it('hacen falta al menos 3 para que sea ráfaga', async () => {
    expect(await vipMetric('metralleta', rapidFire('Ana', 2))).toBeUndefined()
  })

  it('más de 10 segundos entre mensajes rompe la ráfaga', async () => {
    const card = await vipMetric('metralleta', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'dale' },
      { at: '2025-03-10T10:00:05', from: 'Ana', text: 'dale' },
      { at: '2025-03-10T10:00:30', from: 'Ana', text: 'dale' },
    ])

    expect(card).toBeUndefined()
  })

  it('un mensaje largo en el medio rompe la ráfaga', async () => {
    const card = await vipMetric('metralleta', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'dale' },
      { at: '2025-03-10T10:00:05', from: 'Ana', text: 'esto ya es un mensaje mucho mas largo' },
      { at: '2025-03-10T10:00:08', from: 'Ana', text: 'dale' },
    ])

    expect(card).toBeUndefined()
  })

  it('un mensaje del otro corta la ráfaga', async () => {
    const card = await vipMetric('metralleta', [
      ...rapidFire('Ana', 2),
      { at: '2025-03-10T10:00:08', from: 'Beto', text: 'ya' },
      { at: '2025-03-10T10:00:12', from: 'Ana', text: 'dale' },
    ])

    expect(card).toBeUndefined()
  })

  it('el detalle muestra el bloque literal con su encabezado', async () => {
    const card = await requireVipMetric('metralleta', rapidFire('Ana', 4))

    expect(card.detail?.groups?.[0].heading).toBe('Ana encadenó 4 mensajes cortos:')
    expect(card.detail?.paginatedItemsLabel).toBe('Ráfagas de micro-mensajes')
  })
})

// ---------------------------------------------------------------------------
// El Interrogador
// ---------------------------------------------------------------------------

describe('métrica interrogador', () => {
  it('cuenta signos de pregunta, no mensajes', async () => {
    const card = await requireVipMetric('interrogador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que? cuando? donde?' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'no se' },
    ])

    expect(card.basic?.value).toBe('3')
    expect(card.basic?.label).toBe('preguntas hechas por Ana')
  })

  it('no cuenta el signo de apertura del español', async () => {
    const card = await requireVipMetric('interrogador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '¿como estas?' },
    ])

    expect(card.basic?.value).toBe('1')
  })

  it('reparte en porcentaje sobre el total de preguntas', async () => {
    const card = await requireVipMetric('interrogador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que? cuando? donde?' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'y vos?' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 3, displayValue: '75.0%', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '25.0%', color: expect.any(String) },
    ])
  })

  it('sin preguntas no hay tarjeta', async () => {
    expect(
      await vipMetric('interrogador', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'afirmo cosas' }]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// El Dramático
// ---------------------------------------------------------------------------

describe('métrica dramatico', () => {
  it('cuenta los mensajes en mayúsculas', async () => {
    const card = await requireVipMetric('dramatico', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'NO PUEDE SER' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'EN SERIO' },
      { at: '2025-03-10T10:02:00', from: 'Beto', text: 'tranqui' },
    ])

    expect(card.basic?.value).toBe('2')
    expect(card.basic?.label).toBe('mensajes en MAYÚSCULAS de Ana')
  })

  it.each(['OK', 'AH', 'HOLA!!!'])('trata "%s" según la regla de 4 letras', async (text) => {
    const card = await vipMetric('dramatico', [{ at: '2025-03-10T10:00:00', from: 'Ana', text }])
    const letters = text.replace(/[^A-Za-z]/g, '')

    expect(Boolean(card)).toBe(letters.length >= 4)
  })

  it('no cuenta un mensaje sin letras', async () => {
    expect(
      await vipMetric('dramatico', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: '1234!!!!' }]),
    ).toBeUndefined()
  })

  it('cuenta las mayúsculas acentuadas', async () => {
    const card = await requireVipMetric('dramatico', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'QUÉ ÑOÑO' },
    ])

    expect(card.basic?.value).toBe('1')
  })

  it('muestra a lo sumo 3 gritos por persona, del más largo al más corto', async () => {
    const card = await requireVipMetric('dramatico', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'CORTO' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'UN POCO MAS LARGO' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'ESTE ES EL MAS LARGO DE TODOS' },
      { at: '2025-03-10T10:03:00', from: 'Ana', text: 'OTRO MAS' },
    ])

    expect(card.detail?.groups).toHaveLength(3)
    expect(card.detail?.groups?.[0].bubbles.some((bubble) => bubble.text === 'ESTE ES EL MAS LARGO DE TODOS')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// El Tono Picante
// ---------------------------------------------------------------------------

describe('métrica tonopicante', () => {
  it('cuenta los mensajes marcados por el diccionario', async () => {
    const card = await requireVipMetric('tonopicante', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'estas muy sexy' },
      { at: '2025-03-10T22:01:00', from: 'Ana', text: 'me tenes loca' },
      { at: '2025-03-10T22:02:00', from: 'Beto', text: 'gracias' },
    ])

    expect(card.basic?.value).toBe('2')
    expect(card.basic?.label).toBe('mensajes subidos de tono de Ana')
  })

  it('el gráfico principal reparte en porcentaje', async () => {
    const card = await requireVipMetric('tonopicante', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'estas muy sexy' },
      { at: '2025-03-10T22:01:00', from: 'Beto', text: 'que calor, todo ardiente' },
    ])

    expect(bars(card).map((item) => item.displayValue)).toEqual(['50.0%', '50.0%'])
  })

  it('el detalle trae el heatmap horario de los mensajes marcados', async () => {
    const card = await requireVipMetric('tonopicante', [
      { at: '2025-03-10T23:00:00', from: 'Ana', text: 'estas muy sexy' },
    ])

    if (card.detail?.chart?.kind !== 'hourHeatmap') {
      throw new Error('Se esperaba un heatmap horario.')
    }
    expect(card.detail.chart.hours[23]).toBe(1)
    expect(card.detail.chart.peakPeriodLabel).toBe('Más actividad por la noche')
  })

  it('las palabras explícitas van arriba de las cotidianas, sin importar la frecuencia', async () => {
    const card = await requireVipMetric('tonopicante', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'que calor' },
      { at: '2025-03-10T22:01:00', from: 'Ana', text: 'caliente' },
      { at: '2025-03-10T22:02:00', from: 'Ana', text: 'caliente otra vez' },
      { at: '2025-03-10T22:03:00', from: 'Beto', text: 'que culo' },
    ])

    // "culo" es tier explícito y apareció una vez; "caliente" es cotidiano y apareció dos.
    expect(card.detail?.paginatedItems?.[0]).toBe('"culo" se usó 1 veces')
    expect(card.detail?.paginatedItemsLabel).toBe('Palabras más usadas')
  })

  it('el ejemplo de cada persona prioriza el acierto explícito', async () => {
    const card = await requireVipMetric('tonopicante', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'que dia caliente' },
      { at: '2025-03-10T22:01:00', from: 'Ana', text: 'mostrame el culo' },
    ])

    expect(card.detail?.groups?.[0].heading).toContain('"culo"')
    expect(card.detail?.groupsLabel).toBe('Los mensajes más picantes de cada uno')
  })

  it('muestra a lo sumo 5 ejemplos por persona', async () => {
    const card = await requireVipMetric('tonopicante', [
      ...burst({ at: '2025-03-10T22:00:00', from: 'Ana', count: 8, text: () => 'que sexy' }),
    ])

    expect(card.detail?.groups).toHaveLength(5)
  })

  it('no marca una palabra que es parte de otra', async () => {
    expect(
      await vipMetric('tonopicante', [
        { at: '2025-03-10T22:00:00', from: 'Ana', text: 'me duele el hombro y compre un libro' },
      ]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// El Curador de Contenidos
// ---------------------------------------------------------------------------

describe('métrica curador', () => {
  it('cuenta los enlaces por persona', async () => {
    const card = await requireVipMetric('curador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'mira https://a.com y https://b.com' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'https://c.com' },
    ])

    expect(card.basic?.value).toBe('2')
    expect(card.basic?.label).toBe('enlaces compartidos por Ana')
  })

  it.each([
    ['https://www.youtube.com/watch?v=1', 'YouTube'],
    ['https://youtu.be/abc', 'YouTube'],
    ['https://www.tiktok.com/@x/video/1', 'TikTok'],
    ['https://www.instagram.com/reel/x', 'Instagram'],
    ['https://open.spotify.com/track/x', 'Música'],
    ['https://twitter.com/x/status/1', 'X/Twitter'],
    ['https://x.com/x/status/1', 'X/Twitter'],
    ['https://elpais.com/nota', 'Otros'],
  ])('clasifica %s como %s', async (url, category) => {
    const card = await requireVipMetric('curador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: url },
    ])

    if (card.detail?.chart?.kind !== 'donut') {
      throw new Error('Se esperaba un donut de categorías.')
    }
    expect(card.detail.chart.items[0].label).toBe(category)
  })

  it('traduce la categoría de música al inglés', async () => {
    const card = await requireVipMetric(
      'curador',
      [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'https://open.spotify.com/track/x' }],
      'en',
    )

    if (card.detail?.chart?.kind !== 'donut') {
      throw new Error('Se esperaba un donut de categorías.')
    }
    expect(card.detail.chart.items[0].label).toBe('Music')
  })

  it('da un donut propio a cada participante que compartió algo', async () => {
    const card = await requireVipMetric('curador', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'https://youtu.be/a' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'sin links' },
    ])

    expect(card.detail?.series?.map((entry) => entry.name)).toEqual(['Ana'])
  })

  it('sin enlaces no hay tarjeta', async () => {
    expect(
      await vipMetric('curador', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'nada que ver' }]),
    ).toBeUndefined()
  })

  it('no cuenta un "link" sin protocolo', async () => {
    expect(
      await vipMetric('curador', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'entra a youtube.com' }]),
    ).toBeUndefined()
  })
})
