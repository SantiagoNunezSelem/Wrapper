import { beforeEach, describe, expect, it } from 'vitest'
import type { AiProfileState } from '../../types'
import { burst, chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import {
  buildProfileInput,
  MIN_SAMPLE_MESSAGES,
  PROFILE_MESSAGE_WORDS,
  PROFILE_SAMPLE_SIZE,
  profileCardState,
  toProfileOverrides,
  toProfilePayload,
  type ProfileInput,
} from '../personalityAi'

beforeEach(resetMessageIds)

/** `count` mensajes de `from`, uno cada 10 minutos, con el número de orden dentro del texto. */
function talk(from: string, count: number, text: (index: number) => string, day = '2025-03-01'): MessageSpec[] {
  return burst({ at: `${day}T10:00`, from, count, stepMinutes: 10, text })
}

/** Un mensaje largo (6+ palabras) y uno corto, alternados. */
const mixed = (index: number) => (index % 2 === 0 ? `mensaje largo numero ${index} con varias palabras` : `ok ${index}`)

const orderOf = (messages: string[]) =>
  messages.map((text) => Number(/(?:numero|ok) (\d+)/.exec(text)?.[1] ?? Number.NaN))

describe('buildProfileInput — quién entra', () => {
  it('numera a la gente con letras en el orden de quien más escribe', () => {
    const input = buildProfileInput(
      chat(...talk('Ana', 80, mixed), ...talk('Beto', 120, mixed, '2025-03-02'), ...talk('Caro', 60, mixed, '2025-03-03')),
    )

    expect(input.people.map((person) => [person.id, person.name])).toEqual([
      ['A', 'Beto'],
      ['B', 'Ana'],
      ['C', 'Caro'],
    ])
  })

  it('deja afuera a quien no llega al mínimo de mensajes y a quien le quedan muy pocos de muestra', () => {
    const input = buildProfileInput(
      chat(
        ...talk('Ana', 80, mixed),
        ...talk('Poco', 20, mixed, '2025-03-02'),
        // Escribe mucho, pero todo es del vocabulario que no se manda: no le queda muestra.
        ...talk('Callado', 70, () => 'que dia caliente', '2025-03-03'),
      ),
    )

    expect(input.people.map((person) => person.name)).toEqual(['Ana'])
  })

  it('no incluye a los participantes que no son personas', () => {
    const input = buildProfileInput(chat(...talk('Ana', 80, mixed), ...talk('Meta AI', 90, mixed, '2025-03-02')))

    expect(input.people.map((person) => person.name)).toEqual(['Ana'])
  })

  it('sin nadie con suficientes mensajes devuelve un pedido vacío', () => {
    const input = buildProfileInput(chat(...talk('Ana', 10, mixed)))

    expect(input).toEqual({ people: [], group: {} })
  })

  it('cada persona trae sus números medidos y el promedio del grupo viene aparte', () => {
    const input = buildProfileInput(chat(...talk('Ana', 80, mixed), ...talk('Beto', 80, mixed, '2025-03-02')))

    expect(input.people[0].features.share).toBe(0.5)
    expect('replyMinutes' in input.people[0].features).toBe(false)
    expect(input.group.share).toBe(0.5)
    expect(input.group.avgWords).toBeGreaterThan(0)
  })
})

describe('buildProfileInput — la muestra', () => {
  const input = buildProfileInput(chat(...talk('Ana', 200, mixed), ...talk('Beto', 200, mixed, '2025-03-02')))
  const [ana] = input.people

  it('tiene el tamaño acordado', () => {
    expect(ana.messages).toHaveLength(PROFILE_SAMPLE_SIZE)
  })

  it('va en el orden del chat y sale de lo más reciente: lo que no entra es lo más viejo', () => {
    const order = orderOf(ana.messages)

    expect(order).toEqual([...order].sort((left, right) => left - right))
    // Ana escribió 200 mensajes y la muestra tiene 40: son los últimos.
    expect(order.at(-1)).toBe(199)
    expect(order[0]).toBeGreaterThanOrEqual(140)
  })

  it('mezcla mensajes con contenido y respuestas cortas', () => {
    const long = ana.messages.filter((text) => text.includes('mensaje largo')).length
    const short = ana.messages.filter((text) => text.startsWith('ok')).length

    expect(long).toBe(28)
    expect(short).toBe(12)
  })

  it('es siempre la misma para el mismo chat: así un perfil guardado se reconoce', () => {
    const again = buildProfileInput(chat(...talk('Ana', 200, mixed), ...talk('Beto', 200, mixed, '2025-03-02')))

    expect(again.people[0].messages).toEqual(ana.messages)
  })

  it('si casi no hay mensajes cortos, completa con los largos', () => {
    const onlyLong = buildProfileInput(
      chat(...talk('Ana', 100, (index) => `mensaje largo numero ${index} con varias palabras`)),
    )

    expect(onlyLong.people[0].messages).toHaveLength(PROFILE_SAMPLE_SIZE)
  })

  it('si casi no hay mensajes largos, completa con los cortos', () => {
    const onlyShort = buildProfileInput(chat(...talk('Ana', 100, (index) => `ok ${index}`)))

    expect(onlyShort.people[0].messages).toHaveLength(PROFILE_SAMPLE_SIZE)
  })

  it('con menos mensajes que el tamaño de la muestra, manda los que hay', () => {
    const small = buildProfileInput(chat(...talk('Ana', 55, mixed)))

    expect(small.people[0].messages.length).toBeGreaterThanOrEqual(MIN_SAMPLE_MESSAGES)
    expect(small.people[0].messages.length).toBeLessThanOrEqual(55)
  })

  it('recorta cada mensaje a un número de palabras', () => {
    const long = Array.from({ length: 80 }, (_, index) => `palabra${index}`).join(' ')
    const cropped = buildProfileInput(chat(...talk('Ana', 60, () => long)))

    for (const text of cropped.people[0].messages) {
      expect(text.split(/\s+/).filter((word) => word !== '…')).toHaveLength(PROFILE_MESSAGE_WORDS)
      expect(text.endsWith(' …')).toBe(true)
    }
  })

  it('un mensaje de solo signos no entra como respuesta corta', () => {
    const input = buildProfileInput(
      chat(...talk('Ana', 100, (index) => (index % 2 === 0 ? 'mensaje largo numero 1 con varias palabras' : '...'))),
    )

    expect(input.people[0].messages.some((text) => text.trim() === '...')).toBe(false)
  })

  it('un emoji solo sí cuenta: también es cómo escribe esa persona', () => {
    const input = buildProfileInput(chat(...talk('Ana', 100, (index) => (index % 2 === 0 ? 'mensaje largo numero 1 con varias palabras' : '😂'))))

    expect(input.people[0].messages.filter((text) => text === '😂').length).toBeGreaterThan(0)
  })
})

describe('buildProfileInput — lo que NO sale del navegador', () => {
  it('deja afuera el vocabulario sexual de los tres niveles', () => {
    const sexual = ['mostrame el culo', 'hablemos de sexo', 'que dia caliente']
    const specs = talk('Ana', 150, (index) => (index % 3 === 0 ? sexual[(index / 3) % 3] : mixed(index)))

    const sample = buildProfileInput(chat(...specs)).people[0].messages

    for (const forbidden of ['culo', 'sexo', 'caliente']) {
      expect(sample.some((text) => text.includes(forbidden))).toBe(false)
    }
    expect(sample).toHaveLength(PROFILE_SAMPLE_SIZE)
  })

  it('reemplaza los nombres de los participantes por su letra, aun dentro de una palabra mayúscula o con @', () => {
    const input = buildProfileInput(
      chat(
        ...talk('Ana García', 80, (index) => (index % 2 === 0 ? `mensaje largo numero ${index} para CARO y @Beto` : `ok ${index} Ana`)),
        ...talk('Caro', 80, mixed, '2025-03-02'),
        ...talk('Beto', 80, mixed, '2025-03-03'),
      ),
    )
    const ana = input.people.find((person) => person.name === 'Ana García')!
    const letters = new Map(input.people.map((person) => [person.name, person.id]))

    const joined = ana.messages.join('\n')
    expect(joined).toContain(`para ${letters.get('Caro')} y @${letters.get('Beto')}`)
    expect(joined).not.toMatch(/Caro|Beto|CARO/)
    // Un nombre de pila suelto también es el nombre.
    expect(joined).toContain(`ok`)
    expect(joined).not.toContain('Ana')
  })

  it('saca los links, los mails y los teléfonos', () => {
    const text = (index: number) =>
      [
        `mirá esto https://ejemplo.com/perfil?id=${index} que está bueno`,
        `escribime a ana${index}@ejemplo.com cuando puedas porque sí`,
        `llamame al +54 9 11 5555 123${index % 10} que estoy libre hoy`,
      ][index % 3]

    const sample = buildProfileInput(chat(...talk('Ana', 90, text))).people[0].messages

    for (const line of sample) {
      expect(line).not.toMatch(/https?:|@ejemplo|5555/)
    }
    expect(sample.some((line) => line.includes('[link]'))).toBe(true)
    expect(sample.some((line) => line.includes('[mail]'))).toBe(true)
    expect(sample.some((line) => line.includes('[número]'))).toBe(true)
  })

  it('un mensaje que era solo un link no queda como muestra vacía', () => {
    const sample = buildProfileInput(
      chat(...talk('Ana', 100, (index) => (index % 2 === 0 ? 'https://ejemplo.com/video' : mixed(1)))),
    ).people[0].messages

    expect(sample.every((line) => line.replace('[link]', '').trim().length > 0)).toBe(true)
  })

  it('los nombres con caracteres de regex no rompen el reemplazo', () => {
    const input = buildProfileInput(
      chat(...talk('Ana (la mayor)', 80, mixed), ...talk('Beto+', 80, mixed, '2025-03-02')),
    )

    expect(input.people).toHaveLength(2)
  })

  it('quien participó poco igual se oculta: su nombre pasa a "[otro]"', () => {
    const input = buildProfileInput(
      chat(
        ...talk('Ana', 80, (index) => `mensaje largo numero ${index} con Lucas y sus cosas`),
        ...talk('Lucas', 4, mixed, '2025-03-02'),
      ),
    )

    expect(input.people[0].messages.join(' ')).toContain('[otro]')
    expect(input.people[0].messages.join(' ')).not.toContain('Lucas')
  })

  it('un participante cuyo nombre no es una palabra (un teléfono) no genera reglas de nombre', () => {
    const input = buildProfileInput(chat(...talk('+54 9 11 5555-1234', 80, mixed), ...talk('Beto', 80, mixed, '2025-03-02')))

    expect(input.people).toHaveLength(2)
  })

  it('toProfilePayload no lleva ningún nombre real', () => {
    const input = buildProfileInput(chat(...talk('Ana', 80, mixed), ...talk('Beto', 80, mixed, '2025-03-02')))

    const payload = toProfilePayload(input)

    expect(JSON.stringify(payload)).not.toMatch(/Ana|Beto/)
    expect(payload.people.map((person) => Object.keys(person))).toEqual([
      ['id', 'features', 'messages'],
      ['id', 'features', 'messages'],
    ])
    expect(payload.group).toBe(input.group)
  })
})

describe('toProfileOverrides', () => {
  const input: ProfileInput = {
    group: {},
    people: [
      { id: 'A', name: 'Ana', features: {}, messages: [] },
      { id: 'B', name: 'Beto', features: {}, messages: [] },
      { id: 'C', name: 'Caro', features: {}, messages: [] },
    ],
  }

  function result(overrides: Partial<AiProfileState> & { personId: string }): AiProfileState {
    return {
      status: 'ready',
      labelId: 'lider',
      secondaryLabelId: null,
      summary: 'Mueve al grupo y propone planes casi todos los fines de semana.',
      errorCode: null,
      retryAvailableAtUtc: null,
      updatedAtUtc: '2026-11-08T12:00:00Z',
      ...overrides,
    }
  }

  it('mapea la letra de vuelta al nombre real', () => {
    const overrides = toProfileOverrides(input, [
      result({ personId: 'A' }),
      result({ personId: 'C', labelId: 'seco', secondaryLabelId: 'timido', summary: 'Contesta en una palabra.' }),
    ])

    expect([...overrides.keys()]).toEqual(['Ana', 'Caro'])
    expect(overrides.get('Caro')).toEqual({
      labelId: 'seco',
      secondaryLabelId: 'timido',
      summary: 'Contesta en una palabra.',
    })
  })

  it('ignora a quien falló, a quien vino con una etiqueta fuera de la lista y a quien vino sin resumen', () => {
    const overrides = toProfileOverrides(input, [
      result({ personId: 'A', status: 'failed', labelId: null, summary: null, errorCode: 'blocked' }),
      result({ personId: 'B', labelId: 'tóxico' }),
      result({ personId: 'C', summary: '' }),
    ])

    expect(overrides.size).toBe(0)
  })

  it('descarta la segunda etiqueta si es igual a la primera o no es de la lista', () => {
    const same = toProfileOverrides(input, [result({ personId: 'A', secondaryLabelId: 'lider' })])
    const unknown = toProfileOverrides(input, [result({ personId: 'A', secondaryLabelId: 'narcisista' })])

    expect(same.get('Ana')?.secondaryLabelId).toBeUndefined()
    expect(unknown.get('Ana')?.secondaryLabelId).toBeUndefined()
  })

  it('ignora resultados de letras que no pidió', () => {
    expect(toProfileOverrides(input, [result({ personId: 'Z' })]).size).toBe(0)
  })
})

describe('profileCardState', () => {
  const input: ProfileInput = {
    group: {},
    people: [
      { id: 'A', name: 'Ana', features: {}, messages: [] },
      { id: 'B', name: 'Beto', features: {}, messages: [] },
    ],
  }

  const ready = (personId: string): AiProfileState => ({
    personId,
    status: 'ready',
    labelId: 'lider',
    secondaryLabelId: null,
    summary: 'Mueve al grupo.',
    errorCode: null,
    retryAvailableAtUtc: null,
    updatedAtUtc: '2026-11-08T12:00:00Z',
  })

  const failed = (personId: string, errorCode: string | null, retryAvailableAtUtc: string | null): AiProfileState => ({
    ...ready(personId),
    status: 'failed',
    labelId: null,
    summary: null,
    errorCode,
    retryAvailableAtUtc,
  })

  it('está lista solo si todos los pedidos volvieron listos', () => {
    expect(profileCardState(input, [ready('A'), ready('B')])).toEqual({ status: 'ready' })
  })

  it('sin nadie que perfilar no hay nada que haya fallado', () => {
    expect(profileCardState({ people: [], group: {} }, [])).toEqual({ status: 'ready' })
  })

  it('con una sola falla, la tarjeta falla y cuenta por qué', () => {
    expect(profileCardState(input, [ready('A'), failed('B', 'blocked', '2026-11-08T12:02:00Z')])).toEqual({
      status: 'failed',
      errorCode: 'blocked',
      retryAvailableAtUtc: '2026-11-08T12:02:00Z',
    })
  })

  it('el reintento se ofrece recién cuando ya pasaron todos los enfriamientos', () => {
    const state = profileCardState(input, [
      failed('A', 'quota', '2026-11-08T12:05:00Z'),
      failed('B', null, '2026-11-08T12:02:00Z'),
    ])

    expect(state.retryAvailableAtUtc).toBe('2026-11-08T12:05:00Z')
    // Conserva el primer motivo que tenga nombre.
    expect(state.errorCode).toBe('quota')
  })

  it('el que el servidor no devolvió cuenta como fallido', () => {
    expect(profileCardState(input, [ready('A')])).toEqual({
      status: 'failed',
      errorCode: null,
      retryAvailableAtUtc: null,
    })
  })

  it('sin hora de reintento en ninguno, no inventa una', () => {
    const state = profileCardState(input, [failed('A', 'unavailable', null), ready('B')])

    expect(state.retryAvailableAtUtc).toBeNull()
  })
})
