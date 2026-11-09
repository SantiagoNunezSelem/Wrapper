import { beforeEach, describe, expect, it } from 'vitest'
import { chat, resetMessageIds, type MessageSpec } from '../../test/fixtures'
import {
  buildScanPlan,
  HOT_WINDOW_COUNT,
  HOT_WINDOW_LINES,
  hotWindows,
  MIN_SCAN_MESSAGES,
  parseScanFindings,
  SCAN_CHUNK_LINES,
  SCAN_LINE_WORDS,
  SCAN_LINES_PER_PART,
  SCAN_METRIC_PREFIX,
  SCAN_RECENT_MESSAGES,
} from '../aiScan'

beforeEach(resetMessageIds)

/**
 * La lectura: dos tramos del chat que la IA lee entero —los últimos 5.000 mensajes y, si el chat es
 * más largo, las ventanas más calientes de lo anterior— en líneas numeradas, sin un solo nombre.
 */

/** Un minuto por mensaje desde el 1 de enero de 2025, en el formato local sin zona que usan los fixtures. */
function stamp(index: number): string {
  const date = new Date(2025, 0, 1, 0, index)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

/** `count` mensajes tranquilos de dos personas, con su número adentro para reconocerlos. */
function quiet(count: number, text = (index: number) => `todo tranquilo por acá ${index}`): MessageSpec[] {
  return Array.from({ length: count }, (_, index) => ({ at: stamp(index), from: index % 2 ? 'Beto' : 'Ana', text: text(index) }))
}

const lineNumber = (line: string) => Number(line.split(' ')[0])

describe('buildScanPlan — qué se manda', () => {
  it('un chat con muy pocos mensajes no se lee', () => {
    const plan = buildScanPlan(chat(...quiet(MIN_SCAN_MESSAGES - 1)))

    expect(plan.parts).toEqual([])
    expect(plan.lines.size).toBe(0)
  })

  it('un chat chico se lee entero, en un solo tramo, numerado desde 1 y en orden de chat', () => {
    const messages = chat(...quiet(100))
    const plan = buildScanPlan(messages)

    expect(plan.parts).toHaveLength(1)
    expect(plan.parts[0].metricId).toBe(`${SCAN_METRIC_PREFIX}1`)
    expect(plan.parts[0].chunks.map((chunk) => chunk.id)).toEqual(['r1'])

    const lines = plan.parts[0].chunks[0].text.split('\n')
    expect(lines).toHaveLength(100)
    expect(lines.map(lineNumber)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
    expect(lines[0]).toBe('1 A: todo tranquilo por acá 0')
    expect(lines[1]).toBe('2 B: todo tranquilo por acá 1')
    expect(plan.lines.get(1)).toBe(messages[0].id)
    expect(plan.lines.get(100)).toBe(messages[99].id)
  })

  it('los tramos van del más nuevo al más viejo; adentro de cada uno, en el orden en que se leyó la charla', () => {
    const messages = chat(...quiet(900))
    const plan = buildScanPlan(messages)
    const chunks = plan.parts.flatMap((part) => part.chunks)

    expect(chunks.map((chunk) => chunk.id)).toEqual(['r1', 'r2', 'r3'])
    expect(chunks.map((chunk) => chunk.text.split('\n').length)).toEqual([SCAN_CHUNK_LINES, SCAN_CHUNK_LINES, 100])

    // El primer tramo son los mensajes 500 a 899; la línea 1 es la 500, la 400 es la 899.
    expect(plan.lines.get(1)).toBe(messages[500].id)
    expect(plan.lines.get(400)).toBe(messages[899].id)
    // El segundo, del 100 al 499. El tercero, del 0 al 99.
    expect(plan.lines.get(401)).toBe(messages[100].id)
    expect(plan.lines.get(801)).toBe(messages[0].id)
  })

  it('nunca viaja un nombre: cada persona es una letra, también adentro de lo que se dice', () => {
    const messages = chat(
      ...quiet(40),
      { at: stamp(50), from: 'Ana', text: 'Beto mirá https://example.com/algo y llamame al +54 9 11 5555 4444' },
      { at: stamp(51), from: 'Beto', text: 'ana dijo que no, Ana María no viene' },
    )
    const text = buildScanPlan(messages).parts[0].chunks[0].text

    expect(text).toContain('B mirá [link] y llamame al [número]')
    expect(text).not.toMatch(/Beto|Ana|example\.com|5555/)
  })

  it('un mensaje largo se corta, y los saltos de línea no rompen el formato', () => {
    const long = Array.from({ length: 100 }, (_, index) => `palabra${index}`).join(' ')
    const messages = chat(...quiet(40), { at: stamp(50), from: 'Ana', text: `${long}\nsegunda línea` })
    const lines = buildScanPlan(messages).parts[0].chunks[0].text.split('\n')

    // Una línea por mensaje, aunque el mensaje tuviera dos.
    expect(lines).toHaveLength(41)
    const last = lines.at(-1)!
    expect(last.split(' ').length).toBe(2 + SCAN_LINE_WORDS + 1)
    expect(last.endsWith('…')).toBe(true)
  })

  it('con más de 26 personas las letras siguen siendo únicas', () => {
    const specs = Array.from({ length: 60 }, (_, index) => ({ at: stamp(index), from: `Persona ${index % 30}`, text: `hola número ${index}` }))
    const lines = buildScanPlan(chat(...specs)).parts[0].chunks[0].text.split('\n')
    const labels = new Set(lines.map((line) => line.split(' ')[1]))

    expect(labels.size).toBe(30)
    expect(labels.has('P27:')).toBe(true)
  })

  it('los mensajes de sistema y los marcadores sin texto no entran', () => {
    const messages = chat(
      ...quiet(40),
      { at: stamp(50), from: null, text: 'Los mensajes están cifrados' },
      { at: stamp(51), from: 'Ana', isPlaceholder: true, text: '<Media omitted>' },
    )
    const plan = buildScanPlan(messages)

    expect(plan.lines.size).toBe(40)
  })
})

describe('buildScanPlan — un chat más largo que lo que se lee entero', () => {
  // 5.500 mensajes tranquilos; en los 500 más viejos hay tres lugares calientes. Los 5.000 más
  // nuevos se leen enteros; de lo viejo, solo donde se puso feo.
  const specs = quiet(SCAN_RECENT_MESSAGES + 500)
  specs[100] = { ...specs[100], text: 'sos un idiota' }
  specs[101] = { ...specs[101], text: 'sos un imbecil' }
  specs[300] = { ...specs[300], text: 'ME TENES HARTA, DEJAME EN PAZ!!' }
  specs[450] = { ...specs[450], text: 'te voy a matar' }

  const messages = chat(...specs)
  const plan = buildScanPlan(messages)
  const chunks = plan.parts.flatMap((part) => part.chunks)
  const hot = chunks.filter((chunk) => chunk.id.startsWith('h'))
  const recent = chunks.filter((chunk) => chunk.id.startsWith('r'))

  it('los últimos 5.000 mensajes van todos, en tramos de 400', () => {
    expect(recent.reduce((sum, chunk) => sum + chunk.text.split('\n').length, 0)).toBe(SCAN_RECENT_MESSAGES)
    expect(recent.every((chunk) => chunk.text.split('\n').length <= SCAN_CHUNK_LINES)).toBe(true)
  })

  it('de lo anterior solo van ventanas, las de los lugares calientes y sin repetir mensajes', () => {
    expect(hot.length).toBeGreaterThan(0)
    expect(hot.length).toBeLessThanOrEqual(HOT_WINDOW_COUNT)
    expect(hot.every((chunk) => chunk.text.split('\n').length <= HOT_WINDOW_LINES)).toBe(true)

    const olderIndexes = new Set(
      hot.flatMap((chunk) => chunk.text.split('\n').map((line) => messages.findIndex((message) => message.id === plan.lines.get(lineNumber(line))))),
    )

    // Ninguna ventana invade lo que ya se lee entero, y no hay mensajes repetidos entre ventanas.
    expect([...olderIndexes].every((index) => index >= 0 && index < 500)).toBe(true)
    expect(olderIndexes.size).toBe(hot.reduce((sum, chunk) => sum + chunk.text.split('\n').length, 0))
    // Y están los tres lugares calientes.
    for (const hotIndex of [100, 300, 450]) {
      expect(olderIndexes.has(hotIndex)).toBe(true)
    }
  })

  it('una parte nunca pasa del máximo de líneas y se numeran en orden', () => {
    expect(plan.parts.length).toBeGreaterThanOrEqual(3)
    plan.parts.forEach((part, index) => {
      expect(part.metricId).toBe(`${SCAN_METRIC_PREFIX}${index + 1}`)
      expect(part.chunks.reduce((sum, chunk) => sum + chunk.text.split('\n').length, 0)).toBeLessThanOrEqual(SCAN_LINES_PER_PART)
    })
  })

  it('cada línea del plan es un mensaje distinto y todas las líneas tienen número propio', () => {
    expect(new Set(plan.lines.values()).size).toBe(plan.lines.size)
    const all = chunks.flatMap((chunk) => chunk.text.split('\n').map(lineNumber))
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBe(plan.lines.size)
  })
})

describe('hotWindows — dónde se puso feo', () => {
  it('un chat sin nada caliente no tiene ventanas', () => {
    expect(hotWindows(chat(...quiet(200)), 10)).toEqual([])
  })

  it('elige la ventana alrededor de lo caliente y no se pasa de los bordes', () => {
    const specs = quiet(100)
    specs[0] = { ...specs[0], text: 'sos un idiota' }
    specs[99] = { ...specs[99], text: 'sos un imbecil' }

    const windows = hotWindows(chat(...specs), 10)

    expect(windows).toEqual([
      { start: 88, end: 100 },
      { start: 0, end: 12 },
    ])
  })

  it('no superpone ventanas: tres insultos seguidos son un solo lugar', () => {
    const specs = quiet(100)
    for (const index of [50, 51, 52]) {
      specs[index] = { ...specs[index], text: 'sos un idiota' }
    }

    expect(hotWindows(chat(...specs), 10)).toHaveLength(1)
  })

  it('entre dos lugares igual de calientes, gana el más nuevo si hay que elegir uno', () => {
    const specs = quiet(100)
    specs[10] = { ...specs[10], text: 'sos un idiota' }
    specs[80] = { ...specs[80], text: 'sos un idiota' }

    const [only] = hotWindows(chat(...specs), 1)

    expect(only.start).toBeGreaterThan(50)
  })

  it('los gritos y los signos de más también suman, y un mensaje tranquilo no', () => {
    const specs = quiet(100)
    specs[20] = { ...specs[20], text: 'NO ME HABLES MAS PORQUE ESTOY MUY ENOJADA' }
    specs[21] = { ...specs[21], text: 'contestame!!!' }

    expect(hotWindows(chat(...specs), 10)).toHaveLength(1)
  })

  describe('un silencio de más de dos días', () => {
    // Se corre todo lo posterior al mensaje 50 tres días: el hueco queda entre el 50 y el 51.
    const withGap = (specs: MessageSpec[]) =>
      chat(...specs).map((message, index) =>
        index > 50 ? { ...message, timestamp: new Date(Date.parse(message.timestamp) + 3 * 24 * 3_600_000).toISOString() } : message,
      )

    it('solo no alcanza para que un lugar valga la pena', () => {
      expect(hotWindows(withGap(quiet(100)), 10)).toEqual([])
    })

    it('suma a los mensajes de los dos lados y hace que se lea la ventana alrededor', () => {
      const specs = quiet(100)
      specs[52] = { ...specs[52], text: 'ahora aparecés?? contestame!!' }

      const [window] = hotWindows(withGap(specs), 10)

      expect(window.start).toBeLessThanOrEqual(50)
      expect(window.end).toBeGreaterThan(52)
    })
  })

  it('respeta el máximo que se le pide', () => {
    const specs = quiet(400)
    for (let index = 5; index < 400; index += 20) {
      specs[index] = { ...specs[index], text: 'sos un idiota' }
    }

    expect(hotWindows(chat(...specs), 3)).toHaveLength(3)
  })
})

describe('parseScanFindings — lo que contestó la IA', () => {
  const lines = new Map([
    [1, 'm-uno'],
    [2, 'm-dos'],
    [3, 'm-tres'],
  ])

  it('vuelve a poner cada línea en su mensaje y cada código en su categoría', () => {
    const found = parseScanFindings(lines, ['1:ins', '3:cha', '2:ame'])

    expect([...found]).toEqual([
      ['m-uno', 'insults'],
      ['m-tres', 'blackmail'],
      ['m-dos', 'threats'],
    ])
  })

  it('descarta lo que el navegador no numeró, los códigos que no conoce y lo mal formado', () => {
    const found = parseScanFindings(lines, ['99:ins', '1:xyz', 'basura', '2', ':ins', '3: cel ', 'x:ins'])

    expect([...found]).toEqual([['m-tres', 'jealousy']])
  })

  it('sin nada que mapear devuelve un mapa vacío', () => {
    expect(parseScanFindings(lines, []).size).toBe(0)
    expect(parseScanFindings(new Map(), ['1:ins']).size).toBe(0)
  })
})
