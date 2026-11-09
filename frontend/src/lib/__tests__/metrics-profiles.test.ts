import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AiCardState, MetricCard } from '../../types'
import { burst, chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import {
  applyAiProfiles,
  computeAnalysisCore,
  gateAnalysis,
  gateForStorage,
  isAiBlocked,
  isAiCardId,
  isUsingLocalReading,
  matchesConflict,
  PROFILE_METRIC_ID,
  type AiCardStates,
  type AnalysisCore,
} from '../metrics'

beforeEach(resetMessageIds)

/** Cuatro maneras de escribir distintas, 60 mensajes cada una — suficiente para que todos entren. */
function scriptedGroup(): MessageSpec[] {
  const specs: MessageSpec[] = []
  const base = new Date('2025-03-01T08:00:00').getTime()
  const at = (conversation: number, minute: number) =>
    new Date(base + conversation * 5 * 3_600_000 + minute * 60_000).toISOString()

  for (let index = 0; index < 30; index += 1) {
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

async function coreOf(specs: MessageSpec[], language: 'es' | 'en' = 'es'): Promise<AnalysisCore> {
  return computeAnalysisCore('Grupo', chat(...specs), language, 'hash')
}

function profilesCard(cards: MetricCard[]): MetricCard | undefined {
  return cards.find((card) => card.id === PROFILE_METRIC_ID)
}

describe('la tarjeta de personalidades en el análisis', () => {
  it('es una métrica Pro más, con su lectura local ya calculada', async () => {
    const core = await coreOf(scriptedGroup())

    const card = profilesCard(core.rawVipMetrics)!

    expect(card.tier).toBe('vip')
    expect(card.title).toBe('La personalidad de cada integrante')
    expect(card.description).toBe('Quién es Quién')
    expect(card.basic?.value).toBe('Curioso')
    expect(card.detail?.profiles?.map((profile) => profile.name)).toEqual(['Ana', 'Caro', 'Beto', 'Dani'])
    expect(card.detail?.profiles?.every((profile) => profile.source === 'local')).toBe(true)
    expect(profilesCard(core.rawFreeMetrics)).toBeUndefined()
  })

  it('cada persona lleva el mismo color que en el resto de las métricas', async () => {
    const core = await coreOf(scriptedGroup())

    const profiles = profilesCard(core.rawVipMetrics)!.detail!.profiles!

    expect(profiles.every((profile) => Boolean(profile.color))).toBe(true)
    expect(new Set(profiles.map((profile) => profile.color)).size).toBe(4)
  })

  it('sale en el idioma pedido', async () => {
    const card = profilesCard((await coreOf(scriptedGroup(), 'en')).rawVipMetrics)!

    expect(card.title).toBe('The personality of each participant')
    expect(card.basic?.value).toBe('Curious')
  })

  it('un chat chico no tiene la tarjeta, en vez de inventar personalidades', async () => {
    const core = await coreOf([
      ...burst({ at: '2025-03-01T10:00', from: 'Ana', count: 10 }),
      ...burst({ at: '2025-03-02T10:00', from: 'Beto', count: 10 }),
    ])

    expect(profilesCard(core.rawVipMetrics)).toBeUndefined()
  })

  it('con una sola persona activa tampoco: sin con quién compararla no hay personalidad', async () => {
    const core = await coreOf([
      ...burst({ at: '2025-03-01T10:00', from: 'Ana', count: 80, stepMinutes: 5 }),
      ...burst({ at: '2025-03-02T10:00', from: 'Beto', count: 10 }),
    ])

    expect(profilesCard(core.rawVipMetrics)).toBeUndefined()
  })
})

describe('gateAnalysis — la tarjeta de personalidades', () => {
  let core: AnalysisCore

  // El núcleo no se modifica en ningún test de este bloque: se calcula una sola vez.
  beforeAll(async () => {
    core = await coreOf(scriptedGroup())
  })

  const cardWith = (hasVip: boolean, state?: AiCardState): MetricCard => {
    const states: AiCardStates = state ? { [PROFILE_METRIC_ID]: state } : {}
    return profilesCard(gateAnalysis(core, hasVip, states).vipMetrics)!
  }

  it('sin Pro es la tarjeta bloqueada de siempre: ni el titular ni el detalle', () => {
    const card = cardWith(false)

    expect(card.basic).toBeUndefined()
    expect(card.detail).toBeUndefined()
  })

  it.each<AiCardState['status']>(['pending', 'consent'])(
    'con Pro pero en "%s" sigue cerrada: la lectura local no se muestra como si fuera la respuesta',
    (status) => {
      const card = cardWith(true, { status })

      expect(card.basic).toBeUndefined()
      expect(card.detail).toBeUndefined()
      expect(card.ai?.status).toBe(status)
    },
  )

  it('sin estado conocido se trata como pendiente', () => {
    const card = cardWith(true)

    expect(card.basic).toBeUndefined()
    expect(card.ai?.status).toBe('pending')
  })

  it.each<AiCardState>([
    { status: 'failed', errorCode: 'quota', retryAvailableAtUtc: '2026-11-08T12:00:00Z' },
    { status: 'failed' },
    { status: 'unavailable' },
  ])('si la IA falla ($status) muestra la lectura local, completa', (state) => {
    const card = cardWith(true, state)

    expect(card.basic?.value).toBe('Curioso')
    expect(card.detail?.profiles).toHaveLength(4)
    expect(card.ai).toEqual(state)
  })

  it('cuando la IA responde la tarjeta está abierta', () => {
    const card = cardWith(true, { status: 'ready' })

    expect(card.basic).toBeDefined()
    expect(card.detail).toBeDefined()
  })

  it('un fallo de la IA NO abre a las dos métricas de palabras clave: esas siguen cerradas', () => {
    const bundle = gateAnalysis(core, true, {
      tonopicante: { status: 'failed' },
      redflags: { status: 'unavailable' },
      [PROFILE_METRIC_ID]: { status: 'failed' },
    })

    for (const id of ['tonopicante', 'redflags']) {
      const card = bundle.vipMetrics.find((item) => item.id === id)
      if (card) {
        expect(card.basic).toBeUndefined()
        expect(card.detail).toBeUndefined()
      }
    }
    expect(profilesCard(bundle.vipMetrics)?.basic).toBeDefined()
  })

  it('lo que se guarda en el historial incluye la lectura local aunque la IA haya fallado', () => {
    const stored = gateForStorage(core, true, { [PROFILE_METRIC_ID]: { status: 'failed' } })

    expect(profilesCard(stored.vipMetrics)?.detail?.profiles).toHaveLength(4)
  })
})

describe('isAiBlocked e isUsingLocalReading', () => {
  const card = (id: string, ai: AiCardState | undefined, withBasic: boolean): MetricCard => ({
    id,
    title: 't',
    description: 'd',
    tier: 'vip',
    accent: 'tier-purple',
    hasData: true,
    preview: 'p',
    ...(withBasic ? { basic: { value: '1', label: 'x' } } : {}),
    ...(ai ? { ai } : {}),
  })

  it('una tarjeta sin estado de IA no está bloqueada', () => {
    expect(isAiBlocked(card('spammer', undefined, true))).toBe(false)
    expect(isUsingLocalReading(card('spammer', undefined, true))).toBe(false)
  })

  it('lista nunca está bloqueada', () => {
    expect(isAiBlocked(card('redflags', { status: 'ready' }, true))).toBe(false)
    expect(isAiBlocked(card(PROFILE_METRIC_ID, { status: 'ready' }, true))).toBe(false)
  })

  it.each<AiCardState['status']>(['pending', 'consent', 'failed', 'unavailable'])(
    'una métrica de palabras clave en "%s" está bloqueada, tenga lo que tenga',
    (status) => {
      expect(isAiBlocked(card('tonopicante', { status }, true))).toBe(true)
      expect(isAiBlocked(card('redflags', { status }, false))).toBe(true)
      expect(isUsingLocalReading(card('tonopicante', { status }, true))).toBe(false)
    },
  )

  it.each<AiCardState['status']>(['pending', 'consent'])(
    'las personalidades en "%s" están bloqueadas',
    (status) => {
      expect(isAiBlocked(card(PROFILE_METRIC_ID, { status }, false))).toBe(true)
      expect(isUsingLocalReading(card(PROFILE_METRIC_ID, { status }, false))).toBe(false)
    },
  )

  it.each<AiCardState['status']>(['failed', 'unavailable'])(
    'las personalidades en "%s" no están bloqueadas: muestran su lectura local',
    (status) => {
      expect(isAiBlocked(card(PROFILE_METRIC_ID, { status }, true))).toBe(false)
      expect(isUsingLocalReading(card(PROFILE_METRIC_ID, { status }, true))).toBe(true)
    },
  )

  it('sin nada que mostrar no hay lectura local que anunciar', () => {
    expect(isUsingLocalReading(card(PROFILE_METRIC_ID, { status: 'failed' }, false))).toBe(false)
  })

  it('isAiCardId reconoce las tres tarjetas que dependen de la IA', () => {
    expect(isAiCardId('tonopicante')).toBe(true)
    expect(isAiCardId('redflags')).toBe(true)
    expect(isAiCardId(PROFILE_METRIC_ID)).toBe(true)
    expect(isAiCardId('spammer')).toBe(false)
  })
})

describe('applyAiProfiles', () => {
  let core: AnalysisCore

  // El núcleo no se modifica en ningún test de este bloque: se calcula una sola vez.
  beforeAll(async () => {
    core = await coreOf(scriptedGroup())
  })

  it('cambia solo a quien la IA le escribió algo, y el titular acompaña a quien más escribe', () => {
    const updated = applyAiProfiles(
      core,
      'es',
      new Map([
        ['Ana', { labelId: 'lider' as const, summary: 'Mueve al grupo y propone planes casi todos los fines de semana.' }],
      ]),
    )

    const card = profilesCard(updated.rawVipMetrics)!
    const [ana, caro] = card.detail!.profiles!

    expect(ana).toMatchObject({ labelId: 'lider', label: 'Líder', source: 'ai' })
    expect(caro.source).toBe('local')
    expect(card.basic?.value).toBe('Líder')
  })

  it('no toca el núcleo original ni las demás tarjetas', () => {
    const before = profilesCard(core.rawVipMetrics)!

    const updated = applyAiProfiles(core, 'es', new Map([['Ana', { labelId: 'lider' as const, summary: 'Mueve al grupo.' }]]))

    expect(profilesCard(core.rawVipMetrics)).toBe(before)
    expect(before.detail?.profiles?.[0].source).toBe('local')
    expect(updated.rawFreeMetrics).toBe(core.rawFreeMetrics)
    expect(updated.rawVipMetrics.filter((item) => item.id !== PROFILE_METRIC_ID)).toEqual(
      core.rawVipMetrics.filter((item) => item.id !== PROFILE_METRIC_ID),
    )
  })

  it('sin cambios devuelve el mismo núcleo', () => {
    expect(applyAiProfiles(core, 'es', new Map())).toBe(core)
  })

  it('si el núcleo no tiene la tarjeta, no hace nada', async () => {
    const small = await coreOf(burst({ at: '2025-03-01T10:00', from: 'Ana', count: 5 }))

    const updated = applyAiProfiles(small, 'es', new Map([['Ana', { labelId: 'lider' as const, summary: 'x' }]]))

    expect(updated.rawVipMetrics).toEqual(small.rawVipMetrics)
  })

  it('la tarjeta ya reescrita pasa por la compuerta como cualquier otra', () => {
    const updated = applyAiProfiles(core, 'es', new Map([['Beto', { labelId: 'timido' as const, summary: 'Habla poco.' }]]))

    const card = profilesCard(gateAnalysis(updated, true, { [PROFILE_METRIC_ID]: { status: 'ready' } }).vipMetrics)!

    expect(card.detail?.profiles?.[2]).toMatchObject({ name: 'Beto', labelId: 'timido', source: 'ai' })
  })
})

describe('matchesConflict', () => {
  it('reconoce un reproche y deja pasar una charla normal', () => {
    expect(matchesConflict('sos un pelotudo, siempre lo mismo')).toBe(true)
    expect(matchesConflict('nos vemos mañana a las ocho')).toBe(false)
  })
})
