import { describe, expect, it } from 'vitest'
import type { MetricCard } from '../../types'
import { buildSharePayload, readShareSlug, shareUrlFor, toSharedCard } from '../shareStory'

function card(overrides: Partial<MetricCard> = {}): MetricCard {
  return {
    id: 'testamento',
    title: 'El mensaje más largo del chat',
    description: 'El Testamento',
    tier: 'free',
    accent: 'tier-gold',
    hasData: true,
    preview: 'Top 10 de mensajes más largos.',
    basic: {
      value: '1.240',
      label: 'caracteres en el mensaje más largo, de Ana',
      note: '"che te queria contar que ayer me pasó algo increíble..."',
      chart: { kind: 'bar', items: [{ label: 'Ana', value: 1240, displayValue: '1.240' }] },
    },
    detail: {
      intro: 'Los mensajes más extensos de cada integrante.',
      breakdown: [{ name: 'Ana', value: 1240, displayValue: '1.240 caracteres' }],
      groups: [
        {
          id: 'msg-1',
          heading: 'Ana — 210 palabras',
          bubbles: [
            { sender: 'Ana', text: 'che te queria contar que ayer...', timestampLabel: '10 mar', isHighlight: true },
          ],
        },
      ],
      paginatedItemsLabel: 'Mensajes más largos',
    },
    ...overrides,
  }
}

describe('toSharedCard — qué sale del navegador', () => {
  it('conserva la identidad y el estilo de la tarjeta', () => {
    const shared = toSharedCard(card())

    expect(shared.id).toBe('testamento')
    expect(shared.title).toBe('El mensaje más largo del chat')
    expect(shared.description).toBe('El Testamento')
    expect(shared.tier).toBe('free')
    expect(shared.accent).toBe('tier-gold')
  })

  it('NUNCA publica la cita textual del mensaje más largo', () => {
    const shared = toSharedCard(card())

    expect(shared.basic).toBeDefined()
    expect('note' in shared.basic!).toBe(false)
    expect(JSON.stringify(shared)).not.toContain('me pasó algo increíble')
  })

  it('NUNCA publica las burbujas de conversación', () => {
    const shared = toSharedCard(card())

    expect(shared.detail?.groups).toEqual([{ id: 'msg-1', heading: 'Ana — 210 palabras' }])
    expect(JSON.stringify(shared)).not.toContain('che te queria contar')
  })

  it('conserva el encabezado del grupo, que sí es publicable', () => {
    const shared = toSharedCard(card())

    expect(shared.detail?.groups?.[0].heading).toBe('Ana — 210 palabras')
  })

  it('conserva el número, el chart y el desglose', () => {
    const shared = toSharedCard(card())

    expect(shared.basic?.value).toBe('1.240')
    expect(shared.basic?.chart?.kind).toBe('bar')
    expect(shared.detail?.breakdown).toHaveLength(1)
  })

  it('no inventa basic ni detail cuando la tarjeta no los tiene', () => {
    const shared = toSharedCard(card({ basic: undefined, detail: undefined }))

    expect(shared.basic).toBeUndefined()
    expect(shared.detail).toBeUndefined()
  })

  it('deja groups indefinido cuando el detalle no traía ninguno', () => {
    const shared = toSharedCard(card({ detail: { intro: 'solo intro' } }))

    expect(shared.detail?.intro).toBe('solo intro')
    expect(shared.detail?.groups).toBeUndefined()
  })

  it('no muta la tarjeta original', () => {
    const original = card()
    const snapshot = JSON.stringify(original)
    toSharedCard(original)

    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('buildSharePayload — qué tarjetas entran al link', () => {
  it('publica sólo las tarjetas que el usuario podía ver', () => {
    const payload = buildSharePayload([
      card({ id: 'spammer' }),
      card({ id: 'wordcloud', basic: undefined }),
    ])

    expect(payload.map((item) => item.id)).toEqual(['spammer'])
  })

  it('deja afuera una métrica de IA que todavía no tiene veredicto', () => {
    const payload = buildSharePayload([
      card({ id: 'tonopicante', ai: { status: 'pending' } }),
      card({ id: 'redflags', ai: { status: 'failed' } }),
      card({ id: 'spammer' }),
    ])

    expect(payload.map((item) => item.id)).toEqual(['spammer'])
  })

  it('incluye una métrica de IA con veredicto listo', () => {
    const payload = buildSharePayload([card({ id: 'tonopicante', ai: { status: 'ready' } })])

    expect(payload).toHaveLength(1)
  })

  it('devuelve una lista vacía cuando no hay nada compartible', () => {
    expect(buildSharePayload([card({ basic: undefined })])).toEqual([])
    expect(buildSharePayload([])).toEqual([])
  })

  it('recorta cada tarjeta que incluye', () => {
    const payload = buildSharePayload([card()])

    expect(JSON.stringify(payload)).not.toContain('me pasó algo increíble')
    expect(JSON.stringify(payload)).not.toContain('bubbles')
  })
})

describe('readShareSlug', () => {
  it.each([
    ['/s/abc123XYZ890', 'abc123XYZ890'],
    ['/s/abc123XYZ890/', 'abc123XYZ890'],
    ['/s/a', 'a'],
  ])('reconoce %s', (pathname, slug) => {
    expect(readShareSlug(pathname)).toBe(slug)
  })

  it.each(['/', '/suscripcion', '/s/', '/s/abc-123', '/s/abc/extra', '/S/abc123', 's/abc123'])(
    'descarta %s',
    (pathname) => {
      expect(readShareSlug(pathname)).toBeNull()
    },
  )
})

describe('shareUrlFor', () => {
  it('arma la URL contra el origen actual', () => {
    expect(shareUrlFor('abc123')).toBe(`${window.location.origin}/s/abc123`)
  })

  it('el resultado vuelve a ser legible por readShareSlug', () => {
    const url = new URL(shareUrlFor('abc123XYZ890'))

    expect(readShareSlug(url.pathname)).toBe('abc123XYZ890')
  })
})
