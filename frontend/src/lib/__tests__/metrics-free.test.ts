import { beforeEach, describe, expect, it } from 'vitest'
import { burst, chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import type { BarDatum, Language, MetricCard, TimelinePoint } from '../../types'
import { computeAnalysisCore } from '../metrics'

beforeEach(resetMessageIds)

/** Calcula el núcleo y devuelve una métrica gratis por id, o `undefined` si no tuvo datos. */
async function freeMetric(id: string, specs: MessageSpec[], language: Language = 'es') {
  const core = await computeAnalysisCore('Chat', chat(...specs), language, 'hash')
  return core.rawFreeMetrics.find((card) => card.id === id)
}

/** La misma métrica, exigiendo que exista. */
async function requireFreeMetric(id: string, specs: MessageSpec[], language: Language = 'es') {
  const card = await freeMetric(id, specs, language)
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

function timeline(card: MetricCard): TimelinePoint[] {
  if (card.detail?.chart?.kind !== 'timeline') {
    throw new Error('Se esperaba un timeline en el detalle.')
  }
  return card.detail.chart.points
}

// ---------------------------------------------------------------------------
// El Spammer
// ---------------------------------------------------------------------------

describe('métrica spammer', () => {
  const sample: MessageSpec[] = [
    ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 7 }),
    ...burst({ at: '2025-03-10T12:00:00', from: 'Beto', count: 3 }),
  ]

  it('muestra el porcentaje del que más habla', async () => {
    const card = await requireFreeMetric('spammer', sample)

    expect(card.basic?.value).toBe('70.0%')
    expect(card.basic?.label).toBe('de los mensajes son de Ana')
  })

  it('traduce la etiqueta al inglés', async () => {
    const card = await requireFreeMetric('spammer', sample, 'en')

    expect(card.basic?.label).toBe('of all messages are from Ana')
  })

  it('ordena el ranking de mayor a menor y lo expresa en porcentaje', async () => {
    const card = await requireFreeMetric('spammer', sample)

    expect(bars(card)).toEqual([
      { label: 'Ana', value: 7, displayValue: '70.0%', color: expect.any(String) },
      { label: 'Beto', value: 3, displayValue: '30.0%', color: expect.any(String) },
    ])
  })

  it('corta el ranking en 8 participantes', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      at: `2025-03-10T10:${String(index).padStart(2, '0')}:00`,
      from: `P${index}`,
      text: 'hola',
    }))
    const card = await requireFreeMetric('spammer', many)

    expect(bars(card)).toHaveLength(8)
    // El desglose de abajo sí los muestra a todos.
    expect(card.detail?.breakdown).toHaveLength(12)
  })

  it('el timeline del detalle agrupa por mes y en orden cronológico', async () => {
    const card = await requireFreeMetric('spammer', [
      { at: '2025-01-05T10:00:00', from: 'Ana', text: 'enero' },
      { at: '2025-03-05T10:00:00', from: 'Ana', text: 'marzo' },
      { at: '2025-03-06T10:00:00', from: 'Ana', text: 'marzo otra vez' },
    ])

    expect(timeline(card).map((point) => point.value)).toEqual([1, 2])
    expect(timeline(card)[1].label).toBe('2 mensajes')
  })

  it('cuenta los placeholders de multimedia como mensajes', async () => {
    const card = await requireFreeMetric('spammer', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
    ])

    expect(card.basic?.value).toBe('100.0%')
    expect(bars(card)[0].value).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// El Monologuista
// ---------------------------------------------------------------------------

describe('métrica monologuista', () => {
  it('cuenta la racha más larga de mensajes seguidos', async () => {
    const card = await requireFreeMetric('monologuista', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 4 }),
      { at: '2025-03-10T10:10:00', from: 'Beto', text: 'ok' },
      ...burst({ at: '2025-03-10T10:20:00', from: 'Ana', count: 2 }),
    ])

    expect(card.basic?.value).toBe('4')
    expect(card.basic?.label).toBe('mensajes seguidos de Ana sin respuesta')
  })

  it('no cuenta como racha un mensaje aislado', async () => {
    const card = await freeMetric('monologuista', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'uno' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'dos' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'tres' },
    ])

    expect(card).toBeUndefined()
  })

  it('un audio sin texto corta la racha en vez de atravesarla', async () => {
    // 3 de Ana, un audio de Ana, 3 más de Ana: son dos rachas de 3, no una de 7.
    const card = await requireFreeMetric('monologuista', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 }),
      { at: '2025-03-10T10:05:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
      ...burst({ at: '2025-03-10T10:10:00', from: 'Ana', count: 3 }),
    ])

    expect(card.basic?.value).toBe('3')
  })

  it('el ranking guarda la racha máxima de cada uno, no la suma', async () => {
    const card = await requireFreeMetric('monologuista', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-10T11:00:00', from: 'Beto', text: 'corte' },
      ...burst({ at: '2025-03-10T12:00:00', from: 'Ana', count: 2 }),
      ...burst({ at: '2025-03-10T14:00:00', from: 'Beto', count: 3 }),
      { at: '2025-03-10T15:00:00', from: 'Ana', text: 'corte' },
    ])

    expect(bars(card)).toEqual([
      { label: 'Ana', value: 5, displayValue: '5', color: expect.any(String) },
      { label: 'Beto', value: 3, displayValue: '3', color: expect.any(String) },
    ])
  })

  it('cada bloque trae el encabezado con el nombre y la cantidad', async () => {
    const card = await requireFreeMetric('monologuista', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 }),
    ])

    expect(card.detail?.groups?.[0].heading).toBe('Ana encadenó 3 mensajes:')
    expect(card.detail?.paginatedItemsLabel).toBe('Bloques de mensajes seguidos')
  })

  it('el bloque resaltado no cuela un multimedia que la racha nunca contó', async () => {
    // La racha se calcula sobre textMessages; si el bloque se dibujara sobre
    // chatMessages, el audio del medio aparecería como si fuera parte de ella.
    const card = await requireFreeMetric('monologuista', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'uno' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'dos' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'tres' },
    ])
    const texts = card.detail?.groups?.[0].bubbles.map((bubble) => bubble.text) ?? []

    expect(texts).not.toContain('Archivo multimedia')
  })

  it('corta la lista de bloques en 40', async () => {
    const specs: MessageSpec[] = []
    for (let index = 0; index < 60; index += 1) {
      specs.push(
        ...burst({ at: `2025-03-10T${String(index % 24).padStart(2, '0')}:00:00`, from: 'Ana', count: 2 }),
        { at: `2025-03-10T${String(index % 24).padStart(2, '0')}:30:00`, from: 'Beto', text: 'corte' },
      )
    }
    const card = await requireFreeMetric('monologuista', specs)

    expect(card.detail?.groups?.length).toBeLessThanOrEqual(40)
  })
})

// ---------------------------------------------------------------------------
// El Reloj Biológico
// ---------------------------------------------------------------------------

describe('métrica reloj', () => {
  it('llama "Búhos" al chat que habla de noche', async () => {
    const card = await requireFreeMetric('reloj', [
      ...burst({ at: '2025-03-10T23:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-10T09:00:00', from: 'Beto', text: 'buen dia' },
    ])

    expect(card.basic?.value).toBe('Búhos')
    expect(card.basic?.label).toBe('5 mensajes de madrugada o noche')
  })

  it('llama "Madrugadores" al chat que habla de mañana', async () => {
    const card = await requireFreeMetric('reloj', [
      ...burst({ at: '2025-03-10T08:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-10T23:00:00', from: 'Beto', text: 'chau' },
    ])

    expect(card.basic?.value).toBe('Madrugadores')
    expect(card.basic?.label).toBe('5 mensajes matutinos')
  })

  it('desempata a favor de los búhos', async () => {
    const card = await requireFreeMetric('reloj', [
      { at: '2025-03-10T23:00:00', from: 'Ana', text: 'noche' },
      { at: '2025-03-10T08:00:00', from: 'Beto', text: 'mañana' },
    ])

    expect(card.basic?.value).toBe('Búhos')
  })

  it('arma 24 franjas horarias en hora local', async () => {
    const card = await requireFreeMetric('reloj', [
      { at: '2025-03-10T14:30:00', from: 'Ana', text: 'tarde' },
      { at: '2025-03-10T14:45:00', from: 'Ana', text: 'tarde otra vez' },
    ])

    if (card.basic?.chart?.kind !== 'hourHeatmap') {
      throw new Error('Se esperaba un heatmap horario.')
    }
    expect(card.basic.chart.hours).toHaveLength(24)
    expect(card.basic.chart.hours[14]).toBe(2)
    expect(card.basic.chart.hours[15]).toBe(0)
  })

  it.each([
    ['2025-03-10T02:00:00', 'Más actividad de madrugada'],
    ['2025-03-10T09:00:00', 'Más actividad por la mañana'],
    ['2025-03-10T15:00:00', 'Más actividad por la tarde'],
    ['2025-03-10T21:00:00', 'Más actividad por la noche'],
  ])('etiqueta %s como "%s"', async (at, expected) => {
    const card = await requireFreeMetric('reloj', burst({ at, from: 'Ana', count: 3 }))

    if (card.basic?.chart?.kind !== 'hourHeatmap') {
      throw new Error('Se esperaba un heatmap horario.')
    }
    expect(card.basic.chart.peakPeriodLabel).toBe(expected)
  })

  it('da un heatmap propio a cada participante', async () => {
    const card = await requireFreeMetric('reloj', [
      { at: '2025-03-10T09:00:00', from: 'Ana', text: 'temprano' },
      { at: '2025-03-10T23:00:00', from: 'Beto', text: 'tarde' },
    ])

    expect(card.detail?.series?.map((entry) => entry.name)).toEqual(['Ana', 'Beto'])
    const ana = card.detail?.series?.[0].chart
    if (ana?.kind !== 'hourHeatmap') {
      throw new Error('Se esperaba un heatmap horario por persona.')
    }
    expect(ana.hours[9]).toBe(1)
    expect(ana.hours[23]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// El Jajaja Analítico
// ---------------------------------------------------------------------------

describe('métrica jajaja', () => {
  async function laughStyle(text: string) {
    const card = await freeMetric('jajaja', [{ at: '2025-03-10T10:00:00', from: 'Ana', text }])
    return card?.basic?.value
  }

  it.each([
    ['ja', 'Risa seca ("ja")'],
    ['je', 'Risa seca ("ja")'],
    ['jaja', 'Jajaja clásica'],
    ['jajaja', 'Jajaja clásica'],
    ['ajajaja', 'Jajaja clásica'],
    ['jajajaj', 'Jajaja clásica'],
    ['JAJAJA', 'Jajaja clásica'],
    ['jeje', 'Jeje pícaro'],
    ['jiji', 'Jiji tímida'],
    ['jojo', 'Jojo'],
    ['jsjs', 'Jsjsjs'],
    ['hahaha', 'Haha en inglés'],
    ['hehehe', 'Hehe en inglés'],
    ['xd', 'XD'],
    ['xddd', 'XD'],
    ['lol', 'LOL'],
    ['loool', 'LOL'],
    ['lmao', 'LMAO'],
    ['lmfao', 'LMAO'],
    ['rofl', 'ROFL'],
    ['rotfl', 'ROFL'],
    ['ajskdhasjd', 'Perdió el teclado'],
  ])('clasifica "%s" como %s', async (token, expected) => {
    expect(await laughStyle(token)).toBe(expected)
  })

  it.each(['hola', 'j', 'jjjj', 'asdf', 'que', 'jamon'])(
    'no toma "%s" como risa',
    async (token) => {
      expect(await freeMetric('jajaja', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: token }])).toBeUndefined()
    },
  )

  it('cuenta cada risa del mensaje, no el mensaje', async () => {
    const card = await requireFreeMetric('jajaja', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'jaja jaja jaja que bueno' },
    ])

    expect(card.basic?.label).toBe('es el estilo de risa dominante (3 veces)')
  })

  it('elige el estilo más frecuente del chat entero', async () => {
    const card = await requireFreeMetric('jajaja', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'jeje' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'jaja jaja' },
    ])

    expect(card.basic?.value).toBe('Jajaja clásica')
  })

  it('sólo arma serie para quien realmente se rió', async () => {
    const card = await requireFreeMetric('jajaja', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'jaja' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'no me causa gracia' },
    ])

    expect(card.detail?.series?.map((entry) => entry.name)).toEqual(['Ana'])
  })

  it('ignora la risa que viene dentro de un placeholder de multimedia', async () => {
    const card = await freeMetric('jajaja', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '<jaja omitted>', isPlaceholder: true },
    ])

    expect(card).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Guerra de Emojis
// ---------------------------------------------------------------------------

describe('métrica emojis', () => {
  it('elige el emoji más usado del chat', async () => {
    const card = await requireFreeMetric('emojis', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '😂😂😂' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: '❤️' },
    ])

    expect(card.basic?.value).toBe('😂 ×3')
    expect(card.basic?.label).toBe('el emoji favorito del chat')
  })

  it('corta el top general en 5', async () => {
    const card = await requireFreeMetric('emojis', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '😀😃😄😁😆😅🤣😂' },
    ])

    expect(bars(card)).toHaveLength(5)
  })

  it('el desglose muestra el emoji favorito de cada uno', async () => {
    const card = await requireFreeMetric('emojis', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: '😂😂' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: '🔥' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 2, displayValue: '😂 ×2', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '🔥 ×1', color: expect.any(String) },
    ])
  })

  it('corta el top personal en 15 emojis', async () => {
    const text = Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x1f600 + index)).join('')
    const card = await requireFreeMetric('emojis', [{ at: '2025-03-10T10:00:00', from: 'Ana', text }])

    const series = card.detail?.series?.[0].chart
    if (series?.kind !== 'bar') {
      throw new Error('Se esperaba un ranking de emojis por persona.')
    }
    expect(series.items).toHaveLength(15)
  })

  it('no arma la tarjeta cuando nadie usó emojis', async () => {
    expect(
      await freeMetric('emojis', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'sin emojis' }]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Días de Racha
// ---------------------------------------------------------------------------

describe('métrica racha-dias', () => {
  it('cuenta los días consecutivos con al menos un mensaje', async () => {
    const card = await requireFreeMetric('racha-dias', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-11T10:00:00', from: 'Ana', text: 'b' },
      { at: '2025-03-12T10:00:00', from: 'Ana', text: 'c' },
    ])

    expect(card.basic?.value).toBe('3')
    expect(card.basic?.label).toBe('días seguidos con al menos un mensaje')
  })

  it('un día de hueco parte la racha en dos', async () => {
    const card = await requireFreeMetric('racha-dias', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-11T10:00:00', from: 'Ana', text: 'b' },
      { at: '2025-03-15T10:00:00', from: 'Ana', text: 'c' },
    ])

    expect(card.basic?.value).toBe('2')
  })

  it('el día del chat arranca a las 6am, no a medianoche', async () => {
    // 03:00 del día 11 todavía es "la noche del 10": una sola jornada, sin racha de 2.
    const card = await requireFreeMetric('racha-dias', [
      { at: '2025-03-10T22:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-11T03:00:00', from: 'Ana', text: 'b' },
    ])

    expect(card.basic?.value).toBe('1')
  })

  it('la tarjeta compacta muestra 3 rachas y el detalle 8', async () => {
    // 10 rachas de un día separadas por huecos.
    const specs = Array.from({ length: 10 }, (_, index) => ({
      at: `2025-0${index < 5 ? 1 : 2}-${String(index * 3 + 1).padStart(2, '0')}T10:00:00`,
      from: 'Ana',
      text: 'hola',
    }))
    const card = await requireFreeMetric('racha-dias', specs)

    if (card.basic?.chart?.kind !== 'calendarStreak' || card.detail?.chart?.kind !== 'calendarStreak') {
      throw new Error('Se esperaba un calendario de rachas.')
    }
    expect(card.basic.chart.streaks).toHaveLength(3)
    expect(card.detail.chart.streaks).toHaveLength(8)
  })

  it('reparte quién aportó más dentro de las rachas', async () => {
    const card = await requireFreeMetric('racha-dias', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 }),
      { at: '2025-03-11T10:00:00', from: 'Beto', text: 'uno' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 3, displayValue: '75.0%', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '25.0%', color: expect.any(String) },
    ])
  })
})

// ---------------------------------------------------------------------------
// El Testamento
// ---------------------------------------------------------------------------

describe('métrica testamento', () => {
  it('mide el mensaje más largo en caracteres', async () => {
    const card = await requireFreeMetric('testamento', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'corto' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'x'.repeat(120) },
    ])

    expect(card.basic?.value).toBe('120')
    expect(card.basic?.label).toBe('caracteres en el mensaje más largo, de Beto')
  })

  it('cita el mensaje entero cuando entra en 140 caracteres', async () => {
    const card = await requireFreeMetric('testamento', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'un mensaje normal' },
    ])

    expect(card.basic?.note).toBe('"un mensaje normal"')
  })

  it('recorta la cita a 140 caracteres con elipsis', async () => {
    const card = await requireFreeMetric('testamento', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a'.repeat(300) },
    ])

    expect(card.basic?.note).toBe(`"${'a'.repeat(139)}…"`)
  })

  it('separa por miles con el formato del idioma', async () => {
    const [es, en] = await Promise.all([
      requireFreeMetric('testamento', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'a'.repeat(1500) }], 'es'),
      requireFreeMetric('testamento', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'a'.repeat(1500) }], 'en'),
    ])

    expect(es.basic?.value).toBe('1.500')
    expect(en.basic?.value).toBe('1,500')
  })

  it('el desglose ordena por el mensaje más largo de cada uno', async () => {
    const card = await requireFreeMetric('testamento', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a'.repeat(10) },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'b'.repeat(50) },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'a'.repeat(30) },
    ])

    expect(card.detail?.breakdown?.map((entry) => entry.name)).toEqual(['Beto', 'Ana'])
    expect(card.detail?.breakdown?.[0].displayValue).toBe('50 caracteres')
  })

  it('ignora los placeholders de multimedia', async () => {
    expect(
      await freeMetric('testamento', [
        { at: '2025-03-10T10:00:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
      ]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// El Fan de la Multimedia
// ---------------------------------------------------------------------------

describe('métrica multimedia', () => {
  const media = (at: string, from: string): MessageSpec => ({
    at,
    from,
    text: '<Media omitted>',
    isPlaceholder: true,
    isMedia: true,
  })

  it('cuenta los archivos por remitente', async () => {
    const card = await requireFreeMetric('multimedia', [
      media('2025-03-10T10:00:00', 'Ana'),
      media('2025-03-10T10:01:00', 'Ana'),
      media('2025-03-10T10:02:00', 'Beto'),
      { at: '2025-03-10T10:03:00', from: 'Beto', text: 'texto normal' },
    ])

    expect(card.basic?.value).toBe('2')
    expect(card.basic?.label).toBe('archivos multimedia enviados por Ana')
  })

  it('el porcentaje se calcula sólo sobre los multimedia', async () => {
    const card = await requireFreeMetric('multimedia', [
      media('2025-03-10T10:00:00', 'Ana'),
      media('2025-03-10T10:01:00', 'Beto'),
      ...burst({ at: '2025-03-10T11:00:00', from: 'Ana', count: 20 }),
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 1, displayValue: '50.0%', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '50.0%', color: expect.any(String) },
    ])
  })

  it('el detalle muestra a lo sumo los 5 días más cargados', async () => {
    const specs = Array.from({ length: 9 }, (_, index) =>
      media(`2025-03-${String(index + 1).padStart(2, '0')}T10:00:00`, 'Ana'),
    )
    const card = await requireFreeMetric('multimedia', specs)

    expect(bars(card, 'detail')).toHaveLength(5)
  })

  it('no arma la tarjeta en un chat sin multimedia', async () => {
    expect(
      await freeMetric('multimedia', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'solo texto' }]),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// El Políglota
// ---------------------------------------------------------------------------

describe('métrica poliglota', () => {
  it('cuenta los anglicismos de la lista', async () => {
    const card = await requireFreeMetric('poliglota', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que random ese mood bro' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'sorry' },
    ])

    expect(card.basic?.value).toBe('Ana')
    expect(card.basic?.label).toBe('mezcla más anglicismos (3)')
  })

  it('no cuenta un anglicismo que es parte de otra palabra', async () => {
    expect(
      await freeMetric('poliglota', [
        { at: '2025-03-10T10:00:00', from: 'Ana', text: 'sombrero broma matching' },
      ]),
    ).toBeUndefined()
  })

  it('lista los términos favoritos de cada uno', async () => {
    const card = await requireFreeMetric('poliglota', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'random random cool' },
    ])

    const series = card.detail?.series?.[0].chart
    if (series?.kind !== 'bar') {
      throw new Error('Se esperaba un ranking de términos.')
    }
    expect(series.items[0]).toEqual({ label: 'random', value: 2, displayValue: '×2' })
  })

  it('el gráfico principal es un donut con todos los participantes', async () => {
    const card = await requireFreeMetric('poliglota', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'cool' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'same' },
    ])

    if (card.basic?.chart?.kind !== 'donut') {
      throw new Error('Se esperaba un donut.')
    }
    expect(card.basic.chart.items.map((item) => item.label)).toEqual(['Ana', 'Beto'])
  })
})

// ---------------------------------------------------------------------------
// El Velocista
// ---------------------------------------------------------------------------

describe('métrica velocista', () => {
  it('el ganador es el de promedio de palabras más bajo', async () => {
    const card = await requireFreeMetric('velocista', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'ok' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'si' },
      { at: '2025-03-10T10:02:00', from: 'Beto', text: 'esto es un mensaje bastante mas largo que el resto' },
    ])

    expect(card.basic?.value).toBe('1.0')
    expect(card.basic?.label).toBe('palabras promedio por mensaje de Ana')
  })

  it('promedia con un decimal', async () => {
    const card = await requireFreeMetric('velocista', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'una dos tres' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: 'cuatro dos' },
    ])

    expect(card.basic?.value).toBe('2.5')
  })

  it.each([
    ['corto', 'Cortos (1-3)'],
    ['uno dos tres cuatro cinco', 'Medios (4-10)'],
    ['uno dos tres cuatro cinco seis siete ocho nueve diez once', 'Largos (11+)'],
  ])('mete %j en el balde %s', async (text, bucket) => {
    const card = await requireFreeMetric('velocista', [{ at: '2025-03-10T10:00:00', from: 'Ana', text }])

    if (card.detail?.chart?.kind !== 'histogram') {
      throw new Error('Se esperaba un histograma.')
    }
    const filled = card.detail.chart.buckets.filter((item) => item.value > 0)
    expect(filled).toHaveLength(1)
    expect(filled[0].label).toBe(bucket)
  })

  it('no cuenta en el histograma los mensajes sin palabras', async () => {
    const card = await requireFreeMetric('velocista', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: '🎉' },
    ])

    if (card.detail?.chart?.kind !== 'histogram') {
      throw new Error('Se esperaba un histograma.')
    }
    expect(card.detail.chart.buckets.reduce((sum, item) => sum + item.value, 0)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// El Pulso del Chat
// ---------------------------------------------------------------------------

describe('métrica heatmap-anual', () => {
  it('destaca el día más activo', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-12T10:00:00', from: 'Ana', text: 'solo uno' },
    ])

    expect(card.basic?.value).toBe('5')
    expect(card.basic?.label).toContain('mensajes en el día más activo')
  })

  it.fails('la fecha del día más activo debería ser la del mensaje, no la de ayer', async () => {
    // Bug abierto: `formatDate` recibe una clave de día ("2025-03-10"), y
    // `new Date("2025-03-10")` se interpreta como medianoche UTC. Formateada en una
    // zona al oeste de Greenwich —toda América, o sea el público del producto—
    // retrocede un día. Ver "Hallazgos" en TESTING.md.
    const card = await requireFreeMetric('heatmap-anual', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-12T10:00:00', from: 'Ana', text: 'solo uno' },
    ])

    expect(card.basic?.label).toBe('mensajes en el día más activo (10 de mar de 2025)')
  })

  it('hoy el desplazamiento de un día es observable (documenta el bug)', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 5 }),
      { at: '2025-03-12T10:00:00', from: 'Ana', text: 'solo uno' },
    ])

    expect(card.basic?.label).toBe('mensajes en el día más activo (09 de mar de 2025)')
  })

  it('con menos de 60 días de span dibuja punto por día, rellenando los vacíos', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-13T10:00:00', from: 'Ana', text: 'b' },
    ])

    if (card.basic?.chart?.kind !== 'activityWave') {
      throw new Error('Se esperaba una onda de actividad.')
    }
    // 10, 11, 12 y 13: los dos del medio son ceros, no desaparecen.
    expect(card.basic.chart.points.map((point) => point.value)).toEqual([1, 0, 0, 1])
  })

  it('pasa a semanas cuando el chat supera los 60 días', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      { at: '2025-01-06T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-04-07T10:00:00', from: 'Ana', text: 'b' },
    ])

    if (card.basic?.chart?.kind !== 'activityWave') {
      throw new Error('Se esperaba una onda de actividad.')
    }
    // 13 semanas entre enero y abril, no 92 días ni 4 meses.
    expect(card.basic.chart.points.length).toBeGreaterThan(10)
    expect(card.basic.chart.points.length).toBeLessThan(20)
    expect(card.basic.chart.points[0].dateLabel).toContain('–')
  })

  it('pasa a meses cuando el chat supera los 270 días', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      { at: '2024-01-15T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-15T10:00:00', from: 'Ana', text: 'b' },
    ])

    if (card.basic?.chart?.kind !== 'activityWave') {
      throw new Error('Se esperaba una onda de actividad.')
    }
    // Enero 2024 a marzo 2025 = 15 meses, todos presentes aunque estén vacíos.
    expect(card.basic.chart.points).toHaveLength(15)
    expect(card.basic.chart.points.filter((point) => point.value > 0)).toHaveLength(2)
  })

  it('el desglose cuenta días activos por persona, de mayor a menor', async () => {
    const card = await requireFreeMetric('heatmap-anual', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-11T10:00:00', from: 'Ana', text: 'b' },
      { at: '2025-03-11T11:00:00', from: 'Beto', text: 'c' },
    ])

    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 2, displayValue: '2 días activos', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: '1 días activos', color: expect.any(String) },
    ])
  })
})

// ---------------------------------------------------------------------------
// Termómetro Semanal
// ---------------------------------------------------------------------------

describe('métrica termometro', () => {
  it('nombra el día de semana con más mensajes', async () => {
    // 10/03/2025 es lunes.
    const card = await requireFreeMetric('termometro', [
      ...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 }),
      { at: '2025-03-11T10:00:00', from: 'Ana', text: 'martes' },
    ])

    expect(card.basic?.value).toBe('Lun')
    expect(card.basic?.label).toBe('el día de la semana con más mensajes')
  })

  it('usa los nombres en inglés cuando corresponde', async () => {
    const card = await requireFreeMetric(
      'termometro',
      [...burst({ at: '2025-03-10T10:00:00', from: 'Ana', count: 3 })],
      'en',
    )

    expect(card.basic?.value).toBe('Mon')
  })

  it('un mensaje de las 3am cuenta para el día anterior', async () => {
    // Martes 11 a las 03:00 pertenece al lunes 10 conversacional.
    const card = await requireFreeMetric('termometro', [
      { at: '2025-03-11T03:00:00', from: 'Ana', text: 'trasnoche' },
    ])

    expect(card.basic?.value).toBe('Lun')
  })

  it('arma un radar de 7 ejes por participante', async () => {
    const card = await requireFreeMetric('termometro', [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'a' },
      { at: '2025-03-11T10:00:00', from: 'Beto', text: 'b' },
    ])

    const radar = card.detail?.series?.[0].chart
    if (radar?.kind !== 'radar') {
      throw new Error('Se esperaba un radar.')
    }
    expect(radar.axes.map((axis) => axis.axis)).toEqual(['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'])
    expect(card.detail?.breakdown).toEqual([
      { name: 'Ana', value: 1, displayValue: 'Lun', color: expect.any(String) },
      { name: 'Beto', value: 1, displayValue: 'Mar', color: expect.any(String) },
    ])
  })
})

// ---------------------------------------------------------------------------
// El Arrepentido
// ---------------------------------------------------------------------------

describe('métrica arrepentido', () => {
  const deleted = (at: string, from: string): MessageSpec => ({
    at,
    from,
    text: 'Se eliminó este mensaje',
    isDeleted: true,
  })

  it('cuenta los borrados por persona', async () => {
    const card = await requireFreeMetric('arrepentido', [
      deleted('2025-03-10T10:00:00', 'Ana'),
      deleted('2025-03-10T10:01:00', 'Ana'),
      deleted('2025-03-10T10:02:00', 'Beto'),
    ])

    expect(card.basic?.value).toBe('2')
    expect(card.basic?.label).toBe('mensajes borrados por Ana')
    expect(card.detail?.breakdown?.[0].displayValue).toBe('66.7%')
  })

  it('el timeline del detalle agrupa por día', async () => {
    const card = await requireFreeMetric('arrepentido', [
      deleted('2025-03-10T10:00:00', 'Ana'),
      deleted('2025-03-11T10:00:00', 'Ana'),
      deleted('2025-03-11T11:00:00', 'Ana'),
    ])

    expect(timeline(card).map((point) => point.value)).toEqual([1, 2])
    expect(timeline(card)[1].label).toBe('2 envíos')
  })

  it('no arma la tarjeta si nadie borró nada', async () => {
    expect(
      await freeMetric('arrepentido', [{ at: '2025-03-10T10:00:00', from: 'Ana', text: 'hola' }]),
    ).toBeUndefined()
  })
})
