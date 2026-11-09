import { beforeEach, describe, expect, it } from 'vitest'
import { chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import { buildAiCandidates } from '../aiCandidates'

beforeEach(resetMessageIds)

/**
 * Cómo se arma la muestra para la IA cuando hay más aciertos que lugares: de lo más reciente a lo
 * más antiguo, y con variedad de frases antes que repeticiones de la misma.
 */

const at = (index: number) =>
  `2025-03-10T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`

function candidates(specs: MessageSpec[], metricId: 'tonopicante' | 'redflags' = 'redflags') {
  return buildAiCandidates(chat(...specs), metricId)
}

const positionsOf = (messages: ReturnType<typeof chat>, built: ReturnType<typeof buildAiCandidates>) =>
  built.flatMap((candidate) => candidate.messageIds).map((id) => messages.findIndex((message) => message.id === id))

describe('buildAiCandidates — de lo más reciente a lo más antiguo', () => {
  it('si el cupo se acaba antes que el chat, quedan afuera los mensajes más viejos', () => {
    const messages = chat(
      ...Array.from({ length: 90 }, (_, index) => ({
        at: at(index),
        from: index % 2 ? 'Ana' : 'Beto',
        text: `me dejaste en visto otra vez número ${index}`,
      })),
    )

    const built = buildAiCandidates(messages, 'redflags')
    const covered = positionsOf(messages, built)

    // El tope de redflags es 75: entran los 75 más nuevos, del 15 al 89.
    expect(built).toHaveLength(75)
    expect(Math.min(...covered)).toBe(15)
    expect(Math.max(...covered)).toBe(89)
  })

  it('el primer lugar del lote es el mensaje más nuevo', () => {
    const messages = chat(
      { at: at(0), from: 'Ana', text: 'mostrame el culo uno' },
      { at: at(1), from: 'Beto', text: 'mostrame el culo dos' },
      { at: at(2), from: 'Ana', text: 'mostrame el culo tres' },
    )

    const [first] = buildAiCandidates(messages, 'tonopicante')

    expect(first.id).toBe('1')
    expect(first.messageIds).toEqual([messages[2].id])
  })

  it('también vale para tonopicante, con su tope de 300', () => {
    const messages = chat(
      ...Array.from({ length: 350 }, (_, index) => ({
        at: at(index),
        from: index % 2 ? 'Ana' : 'Beto',
        text: `mostrame el culo numero ${index}`,
      })),
    )

    const covered = positionsOf(messages, buildAiCandidates(messages, 'tonopicante'))

    expect(covered).toHaveLength(300)
    expect(Math.min(...covered)).toBe(50)
  })
})

describe('buildAiCandidates — variedad de frases', () => {
  it('una frase que se repite no se queda con el lote: las otras entran antes que sus repeticiones', () => {
    const repeated = Array.from({ length: 20 }, (_, index) => ({
      at: at(10 + index),
      from: 'Ana',
      text: `sos un idiota número ${index}`,
    }))
    const others = [
      { at: at(0), from: 'Beto', text: 'me dejaste en visto' },
      { at: at(1), from: 'Beto', text: 'es tu culpa' },
      { at: at(2), from: 'Beto', text: 'quiero terminar' },
    ]

    const built = candidates([...others, ...repeated])

    // Hay lugar para todas, así que entran todas — pero primero tres de la repetida (las más nuevas)
    // y cada una de las otras; las 17 restantes de la repetida completan después.
    expect(built).toHaveLength(23)
    expect(built.slice(0, 6).map((candidate) => candidate.keyword)).toEqual([
      'sos un idiota',
      'sos un idiota',
      'sos un idiota',
      'quiero terminar',
      'es tu culpa',
      'me dejaste en visto',
    ])
    expect(built.slice(6).every((candidate) => candidate.keyword === 'sos un idiota')).toBe(true)
  })

  it('con pocas frases distintas y lugar de sobra, las repeticiones completan la muestra', () => {
    const built = candidates(
      Array.from({ length: 8 }, (_, index) => ({ at: at(index), from: 'Ana', text: `es tu culpa de nuevo ${index}` })),
    )

    expect(built).toHaveLength(8)
  })

  it('una conversación repetida no gasta lugar ni pasa por el límite de variedad', () => {
    // Ocho veces el mismo intercambio (Ana insulta, Beto se ríe). Los de adentro rodean al insulto con
    // exactamente lo mismo, así que un solo fragmento los cubre a los cuatro: no ocupa más lugar ni
    // cuenta contra el límite de tres por frase.
    const exchange = (index: number): MessageSpec[] => [
      { at: at(index * 2), from: 'Ana', text: 'sos un idiota' },
      { at: at(index * 2 + 1), from: 'Beto', text: 'jajaja' },
    ]
    const built = candidates(Array.from({ length: 8 }, (_, index) => exchange(index)).flat())

    // Los ocho aciertos quedan cubiertos con menos fragmentos que aciertos.
    expect(built.length).toBeLessThan(8)
    expect(built.flatMap((candidate) => candidate.messageIds)).toHaveLength(8)
    expect(built.some((candidate) => candidate.messageIds.length >= 3)).toBe(true)
  })

  it('ninguna categoría se queda con más del 40% de la muestra de red flags', () => {
    const jealousy = [
      'me dejaste en visto', 'quien es ese', 'revisa tu celular', 'estas celoso', 'no confio en vos',
      'con quien estas', 'que escondes', 'con quien hablabas', 'me controlas', 'estas mintiendo',
    ].map((text, index) => ({ at: at(index), from: 'Beto', text }))

    // 90 insultos todos distintos (6 sustantivos por 15 formas de dirigirlos), y todos más nuevos
    // que los celos: sin el tope por categoría llenarían los 75 lugares y los celos, más viejos, no entrarían.
    const nouns = ['idiota', 'imbecil', 'estupido', 'inutil', 'patetico', 'asqueroso']
    const openers = [
      'sos', 'sos un', 'sos una', 'sos re', 'sos un re', 'sos muy', 'sos medio', 'sos tan', 'sos el', 'sos la',
      'eres', 'eres un', 'eres una', 'eres muy', 'eres tan',
    ]
    const insults = nouns.flatMap((noun, row) =>
      openers.map((opener, column) => ({ at: at(20 + row * 15 + column), from: 'Ana', text: `${opener} ${noun}` })),
    )

    const built = candidates([...jealousy, ...insults])
    const jealousyKept = built.filter((candidate) => jealousy.some((spec) => spec.text === candidate.keyword))

    expect(built).toHaveLength(75)
    expect(jealousyKept).toHaveLength(10)
  })
})
