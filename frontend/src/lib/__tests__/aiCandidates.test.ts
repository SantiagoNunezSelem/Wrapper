import { beforeEach, describe, expect, it } from 'vitest'
import { chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import { buildAiCandidates, buildAllAiCandidates, toAcceptedMessageIds } from '../aiCandidates'
import { matchAiKeywordExplicit, matchAiKeywordGeneral } from '../metrics'

beforeEach(resetMessageIds)

function candidates(specs: MessageSpec[], metricId: 'tonopicante' | 'redflags' = 'tonopicante') {
  return buildAiCandidates(chat(...specs), metricId)
}

describe('matchAiKeyword — los dos niveles del diccionario', () => {
  it('el nivel explícito reconoce sólo las palabras más directas', () => {
    expect(matchAiKeywordExplicit('tonopicante', 'mostrame el culo')).toBe('culo')
    expect(matchAiKeywordExplicit('tonopicante', 'que dia caliente')).toBeNull()
  })

  it('el nivel general reconoce el vocabulario cotidiano', () => {
    expect(matchAiKeywordGeneral('tonopicante', 'que dia caliente')).toBe('caliente')
  })

  it('recorre todas las categorías de red flags', () => {
    expect(matchAiKeywordExplicit('redflags', 'me dejaste en visto')).toBe('me dejaste en visto')
    expect(matchAiKeywordExplicit('redflags', 'hoy comimos pizza')).toBeNull()
    expect(matchAiKeywordGeneral('redflags', 'sos posesivo')).toBe('sos posesivo')
  })

  it('normaliza tildes y mayúsculas antes de comparar', () => {
    expect(matchAiKeywordExplicit('tonopicante', 'CULO')).toBe('culo')
    expect(matchAiKeywordExplicit('redflags', 'sos un MANIPULADOR')).toBe('manipulador')
  })

  it('respeta los límites de palabra', () => {
    expect(matchAiKeywordExplicit('tonopicante', 'me duele el hombro')).toBeNull()
    expect(matchAiKeywordGeneral('tonopicante', 'reserve un hotel')).toBeNull()
  })
})

describe('buildAiCandidates', () => {
  it('devuelve vacío cuando ninguna palabra clave aparece', () => {
    expect(
      candidates([
        { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que lindo dia' },
        { at: '2025-03-10T10:01:00', from: 'Beto', text: 'si buenisimo' },
      ]),
    ).toEqual([])
  })

  it('arma el fragmento con el mensaje marcado y sus vecinos', () => {
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'y al final que comiste' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'la comida estaba re caliente' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'jaja igual siempre exageras' },
    ])

    expect(candidate.id).toBe('1')
    expect(candidate.keyword).toBe('caliente')
    expect(candidate.text).toBe(
      ['A: y al final que comiste', '*B: la comida estaba re caliente', 'A: jaja igual siempre exageras'].join('\n'),
    )
  })

  it('anonimiza a los hablantes con letras por orden de aparición', () => {
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana María', text: 'contame algo interesante' },
      { at: '2025-03-10T10:01:00', from: 'Beto Pérez', text: 'estas muy sexy hoy' },
      { at: '2025-03-10T10:02:00', from: 'Carlos', text: 'che estoy leyendo esto' },
    ])

    expect(candidate.text).not.toContain('Ana')
    expect(candidate.text).not.toContain('Beto')
    expect(candidate.text).not.toContain('Carlos')
    expect(candidate.text.split('\n').map((line) => line[0] === '*' ? line[1] : line[0])).toEqual(['A', 'B', 'C'])
  })

  it('la misma persona reusa su letra dentro del fragmento', () => {
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'contame algo interesante' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'estas muy sexy hoy' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'gracias por el dato' },
    ])

    expect(candidate.text.split('\n')[2].startsWith('A:')).toBe(true)
  })

  it('un mensaje largo se manda solo, sin vecinos', () => {
    const long = Array.from({ length: 25 }, (_, index) => `palabra${index}`).join(' ')
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'contexto previo' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: `${long} sexy` },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'contexto posterior' },
    ])

    expect(candidate.text.split('\n')).toHaveLength(1)
    expect(candidate.text.startsWith('*A:')).toBe(true)
  })

  it('amplía la ventana cuando tres mensajes cortos no alcanzan para juzgar', () => {
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'che' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'ok' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'hot' },
      { at: '2025-03-10T10:03:00', from: 'Beto', text: 'jaja' },
      { at: '2025-03-10T10:04:00', from: 'Ana', text: 'si' },
    ])

    // Con alcance 1 la ventana tendría 3 palabras: se abre a 2 por lado.
    expect(candidate.text.split('\n')).toHaveLength(5)
  })

  it('recorta el mensaje alrededor de la palabra clave, no desde el principio', () => {
    const filler = Array.from({ length: 60 }, (_, index) => `p${index}`).join(' ')
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: `${filler} sexy` },
    ])

    expect(candidate.text).toContain('sexy')
    expect(candidate.text).toContain('…')
    // 50 palabras de tope + el prefijo del hablante y la elipsis.
    expect(candidate.text.split(/\s+/).length).toBeLessThanOrEqual(53)
  })

  it('recorta los vecinos más corto que el mensaje marcado', () => {
    const longNeighbour = Array.from({ length: 40 }, (_, index) => `v${index}`).join(' ')
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: longNeighbour },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'que sexy' },
    ])

    const contextLine = candidate.text.split('\n')[0]
    expect(contextLine.endsWith('…')).toBe(true)
    expect(contextLine.split(/\s+/).length).toBeLessThanOrEqual(27)
  })

  it('una conversación repetida se manda una sola vez, cubriendo todos sus mensajes', () => {
    // El intercambio completo (vecinos incluidos) se repite igual, así que las dos
    // veces se renderiza idéntico y un solo veredicto alcanza para ambas.
    const exchange: MessageSpec[] = [
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'y al final que comiste' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'la comida estaba re caliente' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'jaja igual siempre exageras' },
    ]
    const [candidate, ...rest] = candidates([
      ...exchange,
      ...exchange.map((spec, index) => ({ ...spec, at: `2025-03-11T10:0${index}:00` })),
    ])

    expect(rest).toEqual([])
    expect(candidate.messageIds).toHaveLength(2)
  })

  it('numera los ids desde 1 y sin huecos', () => {
    const built = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'mostrame el culo por favor' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'no seas asi conmigo dale' },
      { at: '2025-03-10T10:02:00', from: 'Ana', text: 'estabas muy sexy ayer' },
    ])

    expect(built.map((item) => item.id)).toEqual(['1', '2'])
  })

  it('los aciertos explícitos ocupan los primeros lugares del lote', () => {
    const built = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que dia tan caliente hoy' },
      { at: '2025-03-10T10:01:00', from: 'Beto', text: 'mostrame el culo dale' },
    ])

    expect(built[0].keyword).toBe('culo')
    expect(built[1].keyword).toBe('caliente')
  })

  it('no procesa dos veces el mismo mensaje entre los dos niveles', () => {
    const built = candidates([
      { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que culo caliente' },
    ])

    expect(built).toHaveLength(1)
    expect(built[0].keyword).toBe('culo')
  })

  it('nunca supera los 300 fragmentos por métrica', () => {
    const many = Array.from({ length: 320 }, (_, index) => ({
      at: `2025-03-10T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`,
      from: index % 2 === 0 ? 'Ana' : 'Beto',
      text: `mostrame el culo numero ${index}`,
    }))

    expect(candidates(many)).toHaveLength(300)
  })

  it('excluye del pool los mensajes de sistema y los placeholders', () => {
    const [candidate] = candidates([
      { at: '2025-03-10T10:00:00', from: null, text: 'Los mensajes están cifrados' },
      { at: '2025-03-10T10:01:00', from: 'Ana', text: '<Media omitted>', isPlaceholder: true, isMedia: true },
      { at: '2025-03-10T10:02:00', from: 'Beto', text: 'que sexy che' },
      { at: '2025-03-10T10:03:00', from: 'Ana', text: 'gracias vos tambien' },
    ])

    expect(candidate.text.split('\n')).toHaveLength(2)
    expect(candidate.text).not.toContain('Media omitted')
    expect(candidate.text).not.toContain('cifrados')
  })

  it('ubica una frase clave de varias palabras para recortar alrededor', () => {
    const filler = Array.from({ length: 60 }, (_, index) => `p${index}`).join(' ')
    const [candidate] = candidates(
      [{ at: '2025-03-10T10:00:00', from: 'Ana', text: `${filler} me dejaste en visto ${filler}` }],
      'redflags',
    )

    expect(candidate.keyword).toBe('me dejaste en visto')
    expect(candidate.text).toContain('me dejaste en visto')
  })
})

describe('buildAllAiCandidates', () => {
  it('arma un lote por cada métrica de IA', () => {
    const sets = buildAllAiCandidates(
      chat(
        { at: '2025-03-10T10:00:00', from: 'Ana', text: 'que sexy estas hoy' },
        { at: '2025-03-10T10:01:00', from: 'Beto', text: 'me dejaste en visto ayer' },
      ),
    )

    expect(sets.map((set) => set.metricId)).toEqual(['tonopicante', 'redflags'])
    expect(sets[0].candidates).toHaveLength(1)
    expect(sets[1].candidates).toHaveLength(1)
  })

  it('devuelve el lote vacío para la métrica sin aciertos, no la omite', () => {
    const sets = buildAllAiCandidates(
      chat({ at: '2025-03-10T10:00:00', from: 'Ana', text: 'que sexy estas hoy' }),
    )

    expect(sets).toHaveLength(2)
    expect(sets[1].candidates).toEqual([])
  })
})

describe('toAcceptedMessageIds', () => {
  const built = [
    { id: '1', messageIds: ['m1', 'm2'], keyword: 'sexy', text: 'x' },
    { id: '2', messageIds: ['m3'], keyword: 'hot', text: 'y' },
  ]

  it('expande un id corto a todos los mensajes que representaba', () => {
    expect(toAcceptedMessageIds(built, ['1'])).toEqual(new Set(['m1', 'm2']))
  })

  it('acumula varios ids aceptados', () => {
    expect(toAcceptedMessageIds(built, ['1', '2'])).toEqual(new Set(['m1', 'm2', 'm3']))
  })

  it('ignora un id que el modelo inventó', () => {
    expect(toAcceptedMessageIds(built, ['99'])).toEqual(new Set())
  })

  it('devuelve un set vacío cuando la IA no aceptó nada', () => {
    expect(toAcceptedMessageIds(built, [])).toEqual(new Set())
  })

  it('no duplica un mensaje aunque venga repetido', () => {
    expect(toAcceptedMessageIds(built, ['1', '1'])).toEqual(new Set(['m1', 'm2']))
  })
})
