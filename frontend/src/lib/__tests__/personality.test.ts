import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, ParticipantProfile } from '../../types'
import { burst, chat, message, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import {
  extractFeatures,
  fold,
  groupAverages,
  isPersonalityLabelId,
  MAX_PROFILED_PEOPLE,
  mergeProfileOverrides,
  MIN_MESSAGES_PER_PERSON,
  PERSONALITY_LABEL_IDS,
  personalityEmoji,
  personalityLabelName,
  profilesFromStats,
  profilesResult,
  rankScores,
  toWireFeatures,
  type PersonFeatures,
  type PersonStats,
} from '../personality'

beforeEach(resetMessageIds)

const isConflict = (text: string) => /idiota|culpa tuya/i.test(text)
const deps = { isConflict }

/**
 * Un grupo de cuatro con cuatro maneras de escribir bien distintas, repetido `conversations`
 * veces. Cada conversación arranca con Ana después de cinco horas de silencio y todos
 * contestan en un par de minutos:
 *  - Ana pregunta y propone planes; es siempre quien arranca.
 *  - Caro se ríe, usa apodos y emojis.
 *  - Beto contesta con una palabra.
 *  - Dani grita y se pelea.
 */
function scriptedGroup(conversations = 30): MessageSpec[] {
  const specs: MessageSpec[] = []
  const base = new Date('2025-03-01T08:00:00').getTime()
  const at = (conversation: number, minute: number) =>
    new Date(base + conversation * 5 * 3_600_000 + minute * 60_000).toISOString()

  for (let index = 0; index < conversations; index += 1) {
    specs.push(
      { at: at(index, 0), from: 'Ana', text: '¿vamos mañana al cine? ¿a qué hora nos vemos?' },
      { at: at(index, 2), from: 'Caro', text: 'jajaja dale hermano, yo voy 😂' },
      { at: at(index, 3), from: 'Beto', text: 'ok' },
      { at: at(index, 5), from: 'Dani', text: 'SIEMPRE LO MISMO!!! ES TU CULPA IDIOTA' },
      { at: at(index, 6), from: 'Ana', text: '¿y vos Dani venís? ¿o te quedás renegando?' },
      { at: at(index, 7), from: 'Caro', text: 'jaja che boludo no empieces 😂😂' },
      { at: at(index, 8), from: 'Beto', text: 'dale' },
      { at: at(index, 9), from: 'Dani', text: 'NO ME HABLEN!!!' },
    )
  }

  return specs
}

function featuresOf(stats: PersonStats[], name: string): PersonFeatures {
  return stats.find((person) => person.name === name)!.features
}

/** Una persona armada a mano, para probar el etiquetado sin generar un chat entero. */
function stat(name: string, overrides: Partial<PersonFeatures> = {}, messageCount = 100): PersonStats {
  return {
    name,
    messageCount,
    features: {
      share: 0.25,
      initiative: 0.25,
      replyMinutes: 5,
      avgWords: 6,
      shortRate: 0.2,
      emojiRate: 0.2,
      laughRate: 0.1,
      capsRate: 0.01,
      exclRate: 0.05,
      questionRate: 0.1,
      burstRate: 0.1,
      affectionRate: 0.02,
      conflictRate: 0.01,
      complaintRate: 0.01,
      vocativeRate: 0.03,
      planRate: 0.02,
      ...overrides,
    },
  }
}

describe('fold', () => {
  it('pasa a minúsculas y saca los acentos', () => {
    expect(fold('CARIÑO, ¿Cómo está?')).toBe('carino, ¿como esta?')
  })
})

describe('las etiquetas', () => {
  it('son doce, sin repetir, y las cuatro pedidas están', () => {
    expect(PERSONALITY_LABEL_IDS).toHaveLength(12)
    expect(new Set(PERSONALITY_LABEL_IDS).size).toBe(12)
    for (const requested of ['confianzudo', 'timido', 'suizo', 'agresivo']) {
      expect(PERSONALITY_LABEL_IDS).toContain(requested)
    }
  })

  it('isPersonalityLabelId acepta las de la lista y rechaza el resto', () => {
    expect(isPersonalityLabelId('seco')).toBe(true)
    expect(isPersonalityLabelId('tóxico')).toBe(false)
    expect(isPersonalityLabelId('')).toBe(false)
    expect(isPersonalityLabelId(null)).toBe(false)
    expect(isPersonalityLabelId(undefined)).toBe(false)
  })

  it('cada una tiene nombre en los dos idiomas y una cara', () => {
    for (const id of PERSONALITY_LABEL_IDS) {
      expect(personalityLabelName(id, 'es')).not.toBe('')
      expect(personalityLabelName(id, 'en')).not.toBe('')
      expect(personalityEmoji(id)).not.toBe('')
    }
    expect(personalityLabelName('timido', 'es')).toBe('Tímido')
    expect(personalityLabelName('suizo', 'en')).toBe('Neutral')
  })

  it('el que no toma partido se llama "Neutral" en español también: "Suizo" no se entendía sin explicación', () => {
    // El id sigue siendo `suizo` (los resultados guardados y la lista del backend lo usan);
    // lo que se lee en pantalla es el nombre.
    expect(personalityLabelName('suizo', 'es')).toBe('Neutral')
  })
})

describe('rankScores', () => {
  it('reparte de 0 a 1 según el lugar entre los demás', () => {
    expect(rankScores([10, 30, 20])).toEqual([0, 1, 0.5])
  })

  it('los empates comparten el medio de su lugar', () => {
    expect(rankScores([5, 5, 9])).toEqual([0.25, 0.25, 1])
    expect(rankScores([7, 7, 7])).toEqual([0.5, 0.5, 0.5])
  })

  it('un grupo de uno no tiene "entre los demás": queda en el medio', () => {
    expect(rankScores([42])).toEqual([0.5])
    expect(rankScores([])).toEqual([])
  })
})

describe('extractFeatures — quién entra', () => {
  it('no mide a nadie si ninguno llega al mínimo de mensajes', () => {
    const messages = chat(...burst({ at: '2025-03-01T10:00', from: 'Ana', count: MIN_MESSAGES_PER_PERSON - 1 }))

    expect(extractFeatures(messages, deps)).toEqual([])
  })

  it('las marcas de multimedia no cuentan como mensajes', () => {
    const messages = chat(
      ...burst({ at: '2025-03-01T10:00', from: 'Ana', count: MIN_MESSAGES_PER_PERSON - 1, stepMinutes: 5 }),
      ...Array.from({ length: 30 }, (_, index) => ({
        at: new Date(new Date('2025-03-03T10:00').getTime() + index * 60_000).toISOString(),
        from: 'Ana',
        isPlaceholder: true,
        text: '<Media omitted>',
      })),
    )

    expect(extractFeatures(messages, deps)).toEqual([])
  })

  it('ordena por quién escribe más y se queda con los ocho primeros', () => {
    const specs: MessageSpec[] = []
    for (let person = 0; person < 10; person += 1) {
      specs.push(
        ...burst({
          at: `2025-03-0${(person % 9) + 1}T10:00`,
          from: `Persona ${person}`,
          count: MIN_MESSAGES_PER_PERSON + (10 - person),
          stepMinutes: 5,
        }),
      )
    }

    const stats = extractFeatures(chat(...specs), deps)

    expect(stats).toHaveLength(MAX_PROFILED_PEOPLE)
    expect(stats[0].name).toBe('Persona 0')
    expect(stats[0].messageCount).toBe(MIN_MESSAGES_PER_PERSON + 10)
    expect(stats.map((person) => person.messageCount)).toEqual(
      [...stats.map((person) => person.messageCount)].sort((left, right) => right - left),
    )
  })

  it('en un empate gana quien habló primero', () => {
    const stats = extractFeatures(chat(...scriptedGroup()), deps)

    expect(stats.map((person) => person.name)).toEqual(['Ana', 'Caro', 'Beto', 'Dani'])
    expect(stats.every((person) => person.messageCount === 60)).toBe(true)
  })

  it('ignora los mensajes sin remitente', () => {
    const messages = [
      ...chat(...scriptedGroup()),
      message({ at: '2025-04-01T10:00', from: null, text: 'Ana cambió el asunto' }),
    ]

    expect(extractFeatures(messages, deps)).toHaveLength(4)
  })
})

describe('extractFeatures — qué mide', () => {
  const stats = extractFeatures(chat(...scriptedGroup()), deps)

  it('la parte de los mensajes que escribe cada uno', () => {
    for (const person of stats) {
      expect(person.features.share).toBeCloseTo(0.25)
    }
  })

  it('quién arranca las conversaciones: tras tres horas de silencio, y el primer mensaje del chat', () => {
    expect(featuresOf(stats, 'Ana').initiative).toBe(1)
    expect(featuresOf(stats, 'Caro').initiative).toBe(0)
  })

  it('cuánto tarda en contestar, en minutos, como mediana', () => {
    expect(featuresOf(stats, 'Ana').replyMinutes).toBe(1)
    expect(featuresOf(stats, 'Caro').replyMinutes).toBe(1.5)
    expect(featuresOf(stats, 'Beto').replyMinutes).toBe(1)
  })

  it('el largo de sus mensajes', () => {
    expect(featuresOf(stats, 'Beto').avgWords).toBe(1)
    expect(featuresOf(stats, 'Beto').shortRate).toBe(1)
    expect(featuresOf(stats, 'Ana').shortRate).toBe(0)
    expect(featuresOf(stats, 'Ana').avgWords).toBe(8.5)
  })

  it('preguntas y planes', () => {
    expect(featuresOf(stats, 'Ana').questionRate).toBe(1)
    expect(featuresOf(stats, 'Ana').planRate).toBe(1)
    expect(featuresOf(stats, 'Beto').questionRate).toBe(0)
  })

  it('risas, apodos y emojis', () => {
    const caro = featuresOf(stats, 'Caro')

    expect(caro.laughRate).toBe(1)
    expect(caro.vocativeRate).toBe(1)
    expect(caro.emojiRate).toBe(1.5)
    expect(featuresOf(stats, 'Beto').emojiRate).toBe(0)
  })

  it('gritos, exclamaciones y choques (con el diccionario que le pasan)', () => {
    const dani = featuresOf(stats, 'Dani')

    expect(dani.capsRate).toBe(1)
    expect(dani.exclRate).toBe(1)
    expect(dani.conflictRate).toBe(0.5)
    expect(featuresOf(stats, 'Ana').conflictRate).toBe(0)
  })

  it('las quejas se reconocen aunque lleven acentos o mayúsculas', () => {
    const messages = chat(
      ...burst({
        at: '2025-03-01T10:00',
        from: 'Ana',
        count: MIN_MESSAGES_PER_PERSON,
        stepMinutes: 10,
        text: (index) => (index % 2 === 0 ? 'Qué ASCO esto, estoy harta' : 'todo bien por acá'),
      }),
    )

    expect(extractFeatures(messages, deps)[0].features.complaintRate).toBe(0.5)
  })

  it('el cariño: palabras y emojis', () => {
    const messages = chat(
      ...burst({
        at: '2025-03-01T10:00',
        from: 'Ana',
        count: 52,
        stepMinutes: 10,
        text: (index) => ['te quiero mucho', 'qué lindo día ❤', 'nada', 'ok'][index % 4],
      }),
    )

    expect(extractFeatures(messages, deps)[0].features.affectionRate).toBe(0.5)
  })

  it('un mensaje seguido de otro propio en menos de un minuto es ráfaga', () => {
    const messages = chat(
      ...Array.from({ length: MIN_MESSAGES_PER_PERSON }, (_, index) => ({
        at: new Date(new Date('2025-03-01T10:00').getTime() + index * 20_000).toISOString(),
        from: 'Ana',
        text: `mensaje ${index}`,
      })),
    )

    // Todos menos el primero llegan 20 segundos después del anterior.
    expect(extractFeatures(messages, deps)[0].features.burstRate).toBeCloseTo(
      (MIN_MESSAGES_PER_PERSON - 1) / MIN_MESSAGES_PER_PERSON,
    )
  })

  it('con muy pocas respuestas a otros, la velocidad queda sin determinar', () => {
    // Un monólogo: nadie le contesta ni contesta a nadie.
    const messages = chat(...burst({ at: '2025-03-01T10:00', from: 'Ana', count: MIN_MESSAGES_PER_PERSON, stepMinutes: 5 }))

    expect(extractFeatures(messages, deps)[0].features.replyMinutes).toBeNull()
  })

  it('una respuesta que llega horas después no cuenta como respuesta', () => {
    const specs: MessageSpec[] = []
    for (let index = 0; index < MIN_MESSAGES_PER_PERSON; index += 1) {
      const start = new Date('2025-03-01T08:00').getTime() + index * 24 * 3_600_000
      specs.push(
        { at: new Date(start).toISOString(), from: 'Ana', text: 'hola' },
        { at: new Date(start + 5 * 3_600_000 + 30 * 60_000).toISOString(), from: 'Beto', text: 'hola' },
      )
    }

    expect(extractFeatures(chat(...specs), deps)[1].features.replyMinutes).toBeNull()
  })

  it('un timestamp ilegible no rompe nada', () => {
    const base: ChatMessage[] = chat(...scriptedGroup())
    const broken = base.map((item, index) => (index === 3 ? { ...item, timestamp: 'no es una fecha' } : item))

    const stats = extractFeatures(broken, deps)

    expect(stats).toHaveLength(4)
    expect(Number.isFinite(stats[0].features.initiative)).toBe(true)
  })

  it('si el primer mensaje ya tiene una fecha rara, igual cuenta como arranque', () => {
    const base = chat(...scriptedGroup())
    const broken = [{ ...base[0], timestamp: 'x' }, ...base.slice(1)]

    expect(extractFeatures(broken, deps)[0].features.initiative).toBeGreaterThan(0)
  })
})

describe('extractFeatures — gritar', () => {
  const shoutedBy = (text: string): number => {
    const messages = chat(
      ...burst({ at: '2025-03-01T10:00', from: 'Ana', count: MIN_MESSAGES_PER_PERSON, stepMinutes: 5, text: () => text }),
    )

    return extractFeatures(messages, deps)[0].features.capsRate
  }

  it('hace falta un mínimo de letras: "OK" y "HOLA" no son un grito', () => {
    expect(shoutedBy('OK')).toBe(0)
    expect(shoutedBy('HOLA')).toBe(0)
  })

  it('en mayúsculas y largo, sí', () => {
    expect(shoutedBy('HOLAAAA')).toBe(1)
  })

  it('una frase normal con una sigla o un nombre propio no lo es', () => {
    expect(shoutedBy('Hola, soy Ana y vengo de la UBA')).toBe(0)
  })

  it('un mensaje sin letras tampoco', () => {
    expect(shoutedBy('12345 67890')).toBe(0)
  })
})

describe('toWireFeatures y groupAverages', () => {
  it('redondea a tres decimales y deja afuera lo que no se pudo medir', () => {
    const wire = toWireFeatures(stat('Ana', { share: 0.123456, replyMinutes: null }).features)

    expect(wire.share).toBe(0.123)
    expect('replyMinutes' in wire).toBe(false)
    expect(Object.keys(wire)).toHaveLength(15)
  })

  it('el promedio del grupo ignora a quien no tiene velocidad', () => {
    const averages = groupAverages([
      stat('Ana', { replyMinutes: 2, share: 0.4 }),
      stat('Beto', { replyMinutes: null, share: 0.2 }),
      stat('Caro', { replyMinutes: 4, share: 0.3 }),
    ])

    expect(averages.replyMinutes).toBe(3)
    expect(averages.share).toBe(0.3)
  })

  it('si nadie tiene velocidad, esa clave no aparece', () => {
    const averages = groupAverages([stat('Ana', { replyMinutes: null }), stat('Beto', { replyMinutes: null })])

    expect('replyMinutes' in averages).toBe(false)
    expect(averages.share).toBe(0.25)
  })
})

describe('profilesFromStats — el etiquetado', () => {
  it('cada persona del grupo de ejemplo recibe la personalidad que se le nota', () => {
    const stats = extractFeatures(chat(...scriptedGroup()), deps)

    const profiles = profilesFromStats(stats, 'es')
    const byName = Object.fromEntries(profiles.map((profile) => [profile.name, profile]))

    expect(byName.Ana.labelId).toBe('curioso')
    expect(byName.Ana.secondaryLabelId).toBe('lider')
    expect(byName.Caro.labelId).toBe('bromista')
    expect(byName.Caro.secondaryLabelId).toBe('confianzudo')
    expect(byName.Beto.labelId).toBe('seco')
    expect(byName.Dani.labelId).toBe('agresivo')
    // Cuatro maneras de escribir, cuatro etiquetas: nadie se lleva la de otro.
    expect(new Set(profiles.map((profile) => profile.labelId)).size).toBe(4)
  })

  /**
   * Un grupo "tibio" y una persona que se destaca en lo que define cada etiqueta. Es la
   * prueba de que NINGUNA de las doce es inalcanzable: una etiqueta que no puede ganar nunca
   * es una etiqueta que la pantalla promete y no entrega.
   */
  const standouts: [string, Partial<PersonFeatures>][] = [
    ['confianzudo', { vocativeRate: 0.5, laughRate: 0.3 }],
    ['timido', { share: 0.03, initiative: 0, shortRate: 0.7, burstRate: 0 }],
    ['agresivo', { conflictRate: 0.25, capsRate: 0.2, affectionRate: 0 }],
    ['bromista', { laughRate: 0.9, emojiRate: 1.2 }],
    ['intenso', { share: 0.6, burstRate: 0.7, avgWords: 14 }],
    ['carinoso', { affectionRate: 0.4, emojiRate: 1 }],
    ['lider', { initiative: 0.7, planRate: 0.25 }],
    ['dramatico', { capsRate: 0.35, exclRate: 0.9, emojiRate: 0.9 }],
    ['seco', { shortRate: 0.95, emojiRate: 0, laughRate: 0, affectionRate: 0 }],
    ['curioso', { questionRate: 0.8 }],
    ['quejoso', { complaintRate: 0.35, laughRate: 0 }],
  ]

  it.each(standouts)('quien se destaca en lo de "%s" se lleva "%s"', (expected, overrides) => {
    const peers = ['Beto', 'Caro', 'Dani'].map((name) => stat(name))

    const [first] = profilesFromStats([stat('Ana', overrides), ...peers], 'es')

    expect(first.labelId).toBe(expected)
  })

  it('"Neutral" (id suizo) es quien no se mete en los líos de un grupo que sí se mete', () => {
    const loud = { conflictRate: 0.2, capsRate: 0.25, exclRate: 0.8, complaintRate: 0.2 }
    const stats = [
      stat('Neutral', { conflictRate: 0, capsRate: 0, exclRate: 0, complaintRate: 0, laughRate: 0.1 }),
      stat('Uno', loud),
      stat('Dos', loud),
      stat('Tres', loud),
    ]

    expect(profilesFromStats(stats, 'es')[0].labelId).toBe('suizo')
  })

  it('con dos personas, cada una se queda con una etiqueta distinta', () => {
    const profiles = profilesFromStats(
      [stat('Ana', { questionRate: 0.7, initiative: 0.8 }), stat('Beto', { shortRate: 0.9, emojiRate: 0 })],
      'es',
    )

    expect(profiles).toHaveLength(2)
    expect(profiles[0].labelId).not.toBe(profiles[1].labelId)
  })

  it('con una sola persona no se rompe', () => {
    const [only] = profilesFromStats([stat('Ana')], 'es')

    expect(only.name).toBe('Ana')
    expect(PERSONALITY_LABEL_IDS).toContain(only.labelId)
  })

  it('sin nadie devuelve una lista vacía', () => {
    expect(profilesFromStats([], 'es')).toEqual([])
  })

  it('personas idénticas igual reciben una etiqueta cada una, siempre la misma', () => {
    const stats = [stat('Ana'), stat('Beto'), stat('Caro')]

    const first = profilesFromStats(stats, 'es').map((profile) => profile.labelId)
    const second = profilesFromStats(stats, 'es').map((profile) => profile.labelId)

    expect(first).toEqual(second)
    expect(first).toHaveLength(3)
  })

  it('sin velocidad medida para nadie, usa un punto medio en vez de inventar una', () => {
    const profiles = profilesFromStats([stat('Ana', { replyMinutes: null }), stat('Beto', { replyMinutes: null })], 'es')

    const speed = profiles[0].radar.find((axis) => axis.axis === 'Rapidez')!.value
    expect(speed).toBeGreaterThan(30)
    expect(speed).toBeLessThan(70)
  })

  it('una velocidad desconocida toma la mediana de las conocidas', () => {
    const profiles = profilesFromStats(
      [stat('Ana', { replyMinutes: null }), stat('Beto', { replyMinutes: 1 }), stat('Caro', { replyMinutes: 1 })],
      'es',
    )

    const unknown = profiles[0].radar.find((axis) => axis.axis === 'Rapidez')!.value
    const known = profiles[1].radar.find((axis) => axis.axis === 'Rapidez')!.value
    expect(unknown).toBe(known)
  })
})

describe('profilesFromStats — lo que dice', () => {
  const stats = extractFeatures(chat(...scriptedGroup()), deps)

  it('arma la explicación con la frase de la etiqueta y los números reales de la persona', () => {
    const ana = profilesFromStats(stats, 'es')[0]

    expect(ana.summary).toContain('Pregunta todo')
    expect(ana.summary).toContain('El 100% de sus mensajes son preguntas')
    expect(ana.summary).toContain('Arranca el 100% de las conversaciones')
  })

  it('compara con el grupo cuando la diferencia se nota', () => {
    const profiles = profilesFromStats(stats, 'es')

    expect(profiles[0].summary).toContain('(más que el promedio del grupo)')
    expect(profiles[2].summary).toContain('(menos que el promedio del grupo)')
  })

  it('y no dice nada cuando está cerca del promedio', () => {
    const [first] = profilesFromStats(
      [
        stat('Ana', { laughRate: 0.45, emojiRate: 0.2 }),
        stat('Beto', { laughRate: 0.4, emojiRate: 0.2 }),
        stat('Caro', { laughRate: 0.4, emojiRate: 0.2 }),
      ],
      'es',
    )

    expect(first.summary).not.toContain('promedio del grupo')
  })

  it('con un promedio de cero no compara (no hay con qué)', () => {
    const [first] = profilesFromStats(
      [
        stat('Ana', { laughRate: 0.9, emojiRate: 0 }),
        stat('Beto', { laughRate: 0, emojiRate: 0 }),
        stat('Caro', { laughRate: 0, emojiRate: 0 }),
      ],
      'es',
    )

    expect(first.summary).toContain('Usa 0 emojis por mensaje.')
  })

  it('un porcentaje mínimo se dice "menos del 1%" y no "el menos del 1%"', () => {
    const [, peer] = profilesFromStats(
      [stat('Ana', { conflictRate: 0.3, capsRate: 0.3 }), stat('Beto', { conflictRate: 0.002 }), stat('Caro')],
      'es',
    )

    expect(peer.summary).not.toContain('el menos')
    expect(peer.summary).toMatch(/[Mm]enos del 1%|\d+%/)
  })

  it('los decimales siguen el idioma: coma en español, punto en inglés', () => {
    const spanish = profilesFromStats(stats, 'es')[1].summary
    const english = profilesFromStats(stats, 'en')[1].summary

    expect(spanish).toContain('1,5 emojis')
    expect(english).toContain('1.5 emojis')
  })

  it('en inglés usa los nombres, la frase y la gramática de ese idioma', () => {
    const profiles = profilesFromStats(stats, 'en')

    expect(profiles[0].label).toBe('Curious')
    expect(profiles[0].summary).toContain('Asks about everything')
    expect(profiles[0].summary).toContain('of their messages are questions')
    expect(profiles[0].summary).toContain('(above the group average)')
    expect(profiles[2].summary).toContain('(below the group average)')
    expect(profiles[0].radar.map((axis) => axis.axis)).toEqual([
      'Presence',
      'Initiative',
      'Speed',
      'Expressiveness',
      'Detail',
      'Curiosity',
    ])
  })

  it('el radar tiene seis ejes, de 0 a 100, y no depende de quién escribió la etiqueta', () => {
    const profiles = profilesFromStats(stats, 'es')

    for (const profile of profiles) {
      expect(profile.radar).toHaveLength(6)
      for (const axis of profile.radar) {
        expect(axis.value).toBeGreaterThanOrEqual(0)
        expect(axis.value).toBeLessThanOrEqual(100)
        expect(Number.isInteger(axis.value)).toBe(true)
      }
    }
    expect(profiles[0].radar.map((axis) => axis.axis)).toEqual([
      'Presencia',
      'Iniciativa',
      'Rapidez',
      'Expresividad',
      'Detalle',
      'Curiosidad',
    ])
  })

  it('marca todo como lectura local y guarda en cuántos mensajes se apoya', () => {
    for (const profile of profilesFromStats(stats, 'es')) {
      expect(profile.source).toBe('local')
      expect(profile.messageCount).toBe(60)
    }
  })

  it('mantiene el orden de quien más escribe', () => {
    expect(profilesFromStats(stats, 'es').map((profile) => profile.name)).toEqual(stats.map((person) => person.name))
  })
})

describe('mergeProfileOverrides', () => {
  const local: ParticipantProfile[] = profilesFromStats(
    extractFeatures(chat(...scriptedGroup()), deps),
    'es',
  ).map((profile) => ({ ...profile, color: '#123456' }))

  it('cambia solo a quien la IA le escribió algo', () => {
    const merged = mergeProfileOverrides(
      local,
      new Map([['Beto', { labelId: 'timido' as const, summary: 'Habla poco y contesta con una palabra.' }]]),
      'es',
    )

    expect(merged[2]).toMatchObject({
      name: 'Beto',
      labelId: 'timido',
      label: 'Tímido',
      summary: 'Habla poco y contesta con una palabra.',
      source: 'ai',
    })
    // Todo lo demás de Beto —su radar, su color, su cantidad de mensajes— queda como estaba.
    expect(merged[2].radar).toEqual(local[2].radar)
    expect(merged[2].color).toBe('#123456')
    expect(merged[2].messageCount).toBe(60)
    expect(merged[0]).toEqual(local[0])
    expect(merged[0].source).toBe('local')
  })

  it('reemplaza también la segunda etiqueta, o la saca si la IA no puso ninguna', () => {
    const withSecond = mergeProfileOverrides(
      local,
      new Map([['Ana', { labelId: 'lider' as const, secondaryLabelId: 'curioso' as const, summary: 'Mueve al grupo.' }]]),
      'en',
    )
    const withoutSecond = mergeProfileOverrides(
      local,
      new Map([['Ana', { labelId: 'lider' as const, summary: 'Mueve al grupo.' }]]),
      'es',
    )

    expect(local[0].secondaryLabelId).toBe('lider')
    expect(withSecond[0]).toMatchObject({ labelId: 'lider', label: 'Leader', secondaryLabelId: 'curioso', secondaryLabel: 'Curious' })
    expect('secondaryLabelId' in withoutSecond[0]).toBe(false)
    expect('secondaryLabel' in withoutSecond[0]).toBe(false)
  })

  it('sin cambios devuelve lo mismo', () => {
    expect(mergeProfileOverrides(local, new Map(), 'es')).toEqual(local)
  })
})

describe('profilesResult', () => {
  const profiles = profilesFromStats(extractFeatures(chat(...scriptedGroup()), deps), 'es')

  it('con menos de dos personas no hay tarjeta', () => {
    expect(profilesResult([], 'es')).toEqual({ hasData: false })
    expect(profilesResult(profiles.slice(0, 1), 'es')).toEqual({ hasData: false })
  })

  it('el titular es la personalidad de quien más escribe, con su radar', () => {
    const result = profilesResult(profiles, 'es')

    expect(result.hasData).toBe(true)
    expect(result.basic).toEqual({
      value: 'Curioso',
      label: 'la personalidad de Ana, quien más escribe',
      chart: { kind: 'radar', axes: profiles[0].radar },
    })
    expect(result.detail?.profiles).toEqual(profiles)
    expect(result.detail?.intro).toContain('según cómo escribe')
  })

  it('en inglés cambia el texto, no los datos', () => {
    const result = profilesResult(profilesFromStats(extractFeatures(chat(...scriptedGroup()), deps), 'en'), 'en')

    expect(result.basic?.value).toBe('Curious')
    expect(result.basic?.label).toBe("Ana's personality, the most active")
    expect(result.detail?.intro).toContain('based on how they write')
  })
})
