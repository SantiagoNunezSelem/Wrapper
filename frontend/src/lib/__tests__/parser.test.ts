import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseChatFile, parseChatText } from '../parser'

/** Un export de WhatsApp de Android en español: `DD/MM/AAAA, HH:MM - Nombre: texto`. */
const androidEs = [
  '13/03/2025, 21:15 - Ana: hola que haces',
  '13/03/2025, 21:16 - Beto: nada aca',
  '14/03/2025, 09:02 - Ana: buen dia',
].join('\n')

async function parse(text: string) {
  return parseChatText(text)
}

describe('parseChatText — formato base', () => {
  it('extrae remitente, texto y timestamp de cada línea', async () => {
    const { messages } = await parse(androidEs)

    expect(messages).toHaveLength(3)
    expect(messages[0].sender).toBe('Ana')
    expect(messages[0].message).toBe('hola que haces')
    expect(messages[0].contentText).toBe('hola que haces')
    expect(messages[1].sender).toBe('Beto')
  })

  it('interpreta la hora como hora local, no como UTC', async () => {
    const { messages } = await parse(androidEs)

    // Round-trip: el parser construye `new Date(y, m-1, d, h, min)` (local) y guarda
    // el ISO en UTC; releerlo con getHours() tiene que devolver la hora escrita.
    const parsed = new Date(messages[0].timestamp)
    expect(parsed.getHours()).toBe(21)
    expect(parsed.getMinutes()).toBe(15)
    expect(parsed.getDate()).toBe(13)
    expect(parsed.getMonth()).toBe(2)
    expect(parsed.getFullYear()).toBe(2025)
  })

  it('acepta segundos opcionales en la hora', async () => {
    const { messages } = await parse('13/03/2025, 21:15:42 - Ana: hola')

    expect(new Date(messages[0].timestamp).getSeconds()).toBe(42)
  })

  it('acepta guiones como separador de fecha', async () => {
    const { messages } = await parse('13-03-2025, 21:15 - Ana: hola')

    expect(messages).toHaveLength(1)
    expect(new Date(messages[0].timestamp).getDate()).toBe(13)
  })

  it('acepta la variante con corchetes y guion', async () => {
    const { messages } = await parse('[13/03/2025, 21:15:00] - Ana: hola')

    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('Ana')
  })

  it('expande un año de dos dígitos al 2000', async () => {
    const { messages } = await parse('13/03/25, 21:15 - Ana: hola')

    expect(new Date(messages[0].timestamp).getFullYear()).toBe(2025)
  })

  it('numera los ids con el ISO y la posición, sin repetir', async () => {
    const { messages } = await parse(androidEs)
    const ids = messages.map((item) => item.id)

    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(`${messages[0].timestamp}-0`)
    expect(ids[2]).toBe(`${messages[2].timestamp}-2`)
  })
})

describe('parseChatText — inferencia del orden de fecha', () => {
  it('usa DMY cuando algún día supera 12', async () => {
    const { messages } = await parse(
      ['25/03/2025, 10:00 - Ana: uno', '26/03/2025, 10:00 - Ana: dos'].join('\n'),
    )

    expect(new Date(messages[0].timestamp).getDate()).toBe(25)
    expect(new Date(messages[0].timestamp).getMonth()).toBe(2)
  })

  it('usa MDY cuando el segundo número supera 12', async () => {
    const { messages } = await parse('03/25/2025, 10:00 - Ana: uno')

    expect(new Date(messages[0].timestamp).getMonth()).toBe(2)
    expect(new Date(messages[0].timestamp).getDate()).toBe(25)
  })

  it('gana el orden más votado cuando el archivo mezcla ambos', async () => {
    // Tres líneas con día > 12 contra una con mes > 12: DMY tiene que ganar.
    const { messages } = await parse(
      [
        '13/01/2025, 10:00 - Ana: a',
        '14/01/2025, 10:00 - Ana: b',
        '15/01/2025, 10:00 - Ana: c',
        '01/13/2025, 10:00 - Ana: d',
      ].join('\n'),
    )

    expect(new Date(messages[0].timestamp).getDate()).toBe(13)
  })

  it('sólo mira las primeras 50 líneas para votar', async () => {
    // Un único voto MDY dentro de la ventana, contra diez votos DMY fuera de ella.
    // Si contaran todas las líneas ganaría DMY; que gane MDY es la prueba del corte.
    const inWindow = [
      '01/20/2025, 10:00 - Ana: voto MDY',
      ...Array.from({ length: 49 }, (_, index) => `0${(index % 9) + 1}/0${(index % 9) + 1}/2025, 10:00 - Ana: ${index}`),
    ]
    const outsideWindow = Array.from({ length: 10 }, () => '25/01/2025, 10:00 - Ana: voto DMY tardío')

    const { messages } = await parse([...inWindow, ...outsideWindow].join('\n'))

    // Ganó MDY, así que "25/01" se lee como mes 25 y Date lo normaliza a enero de 2027.
    expect(new Date(messages.at(-1)!.timestamp).getFullYear()).toBe(2027)
  })

  it('un archivo ambiguo de 24 horas se lee como DMY', async () => {
    // Ningún día pasa de 12, así que las cifras solas no deciden. El reloj de 24 horas
    // descarta en-US, y día/mes es lo que usa el resto de los idiomas.
    const { messages } = await parse('03/04/2025, 10:00 - Ana: hola')

    expect(new Date(messages[0].timestamp).getDate()).toBe(3)
    expect(new Date(messages[0].timestamp).getMonth()).toBe(3)
  })

  it('un archivo ambiguo con AM/PM se lee como MDY', async () => {
    // El reloj de 12 horas es prácticamente exclusivo de en-US, que escribe mes/día.
    const { messages } = await parse('03/04/25, 10:00 AM - Ana: hola')

    expect(new Date(messages[0].timestamp).getMonth()).toBe(2)
    expect(new Date(messages[0].timestamp).getDate()).toBe(4)
  })
})

describe('parseChatText — mensajes multilínea', () => {
  it('pega al mensaje anterior las líneas que no arrancan con fecha', async () => {
    const { messages } = await parse(
      ['13/03/2025, 21:15 - Ana: primera', 'segunda linea', 'tercera linea'].join('\n'),
    )

    expect(messages).toHaveLength(1)
    expect(messages[0].message).toBe('primera\nsegunda linea\ntercera linea')
  })

  it('cuenta las palabras de todas las líneas del mensaje', async () => {
    const { messages } = await parse(
      ['13/03/2025, 21:15 - Ana: una dos', 'tres cuatro cinco'].join('\n'),
    )

    expect(messages[0].wordCount).toBe(5)
  })

  it('descarta el preámbulo anterior al primer mensaje con fecha', async () => {
    const { messages } = await parse(['basura inicial', 'mas basura', androidEs].join('\n'))

    expect(messages).toHaveLength(3)
    expect(messages[0].message).toBe('hola que haces')
  })

  it('devuelve una lista vacía cuando ninguna línea tiene formato de mensaje', async () => {
    const { messages } = await parse('esto no es un export de whatsapp')

    expect(messages).toEqual([])
  })
})

describe('parseChatText — mensajes de sistema y remitente', () => {
  it('marca como sistema la línea sin "Nombre: "', async () => {
    const { messages } = await parse(
      '13/03/2025, 21:15 - Los mensajes están cifrados de extremo a extremo',
    )

    expect(messages[0].sender).toBeNull()
    expect(messages[0].isSystem).toBe(true)
  })

  it('no confunde un mensaje que empieza con dos puntos con un remitente', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - : arranca con dos puntos')

    // `indexOf(': ')` en la posición 0 no cuenta como remitente (`> 0`).
    expect(messages[0].sender).toBeNull()
  })

  it('corta el remitente en los PRIMEROS dos puntos, no en los últimos', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - Ana: mira esto: es increible')

    expect(messages[0].sender).toBe('Ana')
    expect(messages[0].message).toBe('mira esto: es increible')
  })

  it('conserva un remitente con espacios y emoji', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - Ana María 🌻: hola')

    expect(messages[0].sender).toBe('Ana María 🌻')
  })
})

describe('parseChatText — multimedia, borrados y marcadores', () => {
  it.each([
    ['<Media omitted>', 'inglés con corchetes'],
    ['<Multimedia omitido>', 'español con corchetes'],
    ['imagen omitida', 'imagen en español sin corchetes'],
    ['audio omitted', 'audio en inglés sin corchetes'],
    ['nota de audio omitida', 'nota de voz en español'],
    ['sticker omitted', 'figurita en inglés'],
    ['figurita omitida', 'figurita en español'],
    ['documento omitido', 'documento en español'],
    ['tarjeta de contacto omitida', 'contacto en español'],
    ['video note omitted', 'nota de video en inglés'],
  ])('reconoce %s como multimedia (%s)', async (marker) => {
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: ${marker}`)

    expect(messages[0].isMedia).toBe(true)
  })

  it('deja el placeholder sin contentText y lo marca como tal', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - Ana: <Media omitted>')

    expect(messages[0].contentText).toBe('')
    expect(messages[0].isSystemPlaceholder).toBe(true)
    expect(messages[0].wordCount).toBe(0)
    // El texto crudo se conserva para poder mostrarlo literal si hace falta.
    expect(messages[0].message).toBe('<Media omitted>')
  })

  it('no marca como multimedia una frase que sólo se le parece', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - Ana: la imagen que mandaste estaba rara')

    expect(messages[0].isMedia).toBe(false)
    expect(messages[0].isSystemPlaceholder).toBe(false)
  })

  it.each([
    'This message was deleted',
    'You deleted this message',
    'Se eliminó este mensaje',
    'Eliminaste este mensaje',
  ])('reconoce "%s" como mensaje borrado', async (marker) => {
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: ${marker}`)

    expect(messages[0].isDeleted).toBe(true)
  })

  it('saca el marcador "<This message was edited>" del texto analizable', async () => {
    const { messages } = await parse(
      '13/03/2025, 21:15 - Ana: nos vemos a las 8 <This message was edited>',
    )

    expect(messages[0].contentText).toBe('nos vemos a las 8')
    expect(messages[0].message).toContain('<This message was edited>')
    expect(messages[0].isSystemPlaceholder).toBe(false)
  })

  it('no deja que un marcador con salto de línea se coma el mensaje entero', async () => {
    const { messages } = await parse(
      ['13/03/2025, 21:15 - Ana: <esto abre', 'y esto cierra> texto real'].join('\n'),
    )

    // El patrón de marcadores prohíbe saltos de línea, así que nada se borra.
    expect(messages[0].contentText).toContain('texto real')
    expect(messages[0].contentText).toContain('esto abre')
  })

  it('no deja que un marcador larguísimo se coma el mensaje entero', async () => {
    const long = 'x'.repeat(80)
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: <${long}> texto real`)

    // El cuerpo del marcador está topeado en 60 caracteres.
    expect(messages[0].contentText).toContain(long)
  })
})

describe('parseChatText — marcas invisibles', () => {
  const LTR = '‎'

  it('reconoce una línea prefijada con U+200E como mensaje nuevo', async () => {
    const { messages } = await parse(
      [`${LTR}13/03/2025, 21:15 - Ana: uno`, `${LTR}13/03/2025, 21:16 - Beto: dos`].join('\n'),
    )

    expect(messages).toHaveLength(2)
    expect(messages[1].sender).toBe('Beto')
  })

  it('reconoce el multimedia aunque la marca invisible esté pegada al marcador', async () => {
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: ${LTR}<Media omitted>`)

    expect(messages[0].isMedia).toBe(true)
  })

  it('limpia las marcas invisibles del texto analizable', async () => {
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: hola${LTR} mundo`)

    expect(messages[0].contentText).toBe('hola mundo')
  })
})

describe('parseChatText — conteo de palabras', () => {
  it.each([
    ['hola mundo', 2],
    ["no sé qué decir", 4],
    ["it's fine", 2],
    ['1234 5678', 2],
    ['🎉🎉🎉', 0],
    ['uno, dos; tres.', 3],
    ['...', 0],
    ['¿¡?!', 0],
    ['hola     mundo', 2],
  ])('cuenta %j como %i palabras', async (text, expected) => {
    const { messages } = await parse(`13/03/2025, 21:15 - Ana: ${text}`)

    expect(messages[0].wordCount).toBe(expected)
  })

  it('trata una línea sin texto después del nombre como mensaje de sistema', async () => {
    // Sin nada después de "Ana:", el trim se lleva el espacio y ya no hay ": " que
    // separe remitente de contenido — la línea entera pasa a leerse como sistema.
    const { messages } = await parse('13/03/2025, 21:15 - Ana: ')

    expect(messages[0].sender).toBeNull()
    expect(messages[0].isSystem).toBe(true)
    expect(messages[0].contentText).toBe('Ana:')
  })
})

describe('parseChatText — huella del archivo', () => {
  it('da el mismo hash para el mismo chat guardado con CRLF', async () => {
    const [lf, crlf] = await Promise.all([
      parse(androidEs),
      parse(androidEs.replace(/\n/g, '\r\n')),
    ])

    expect(crlf.sourceHash).toBe(lf.sourceHash)
  })

  it('ignora el BOM y los espacios de los extremos', async () => {
    const [plain, decorated] = await Promise.all([
      parse(androidEs),
      parse(`﻿\n  ${androidEs}\n\n`),
    ])

    expect(decorated.sourceHash).toBe(plain.sourceHash)
  })

  it('cambia el hash ante cualquier cambio real de contenido', async () => {
    const [original, edited] = await Promise.all([
      parse(androidEs),
      parse(androidEs.replace('nada aca', 'nada acá')),
    ])

    expect(edited.sourceHash).not.toBe(original.sourceHash)
  })

  it('expone una vista previa de 200 caracteres para diagnosticar exports vacíos', async () => {
    const { rawTextPreview } = await parse('x'.repeat(500))

    expect(rawTextPreview).toHaveLength(200)
    expect(rawTextPreview).toBe('x'.repeat(200))
  })

  it('la vista previa es el texto completo cuando es corto', async () => {
    const { rawTextPreview, messages } = await parse('archivo raro')

    expect(rawTextPreview).toBe('archivo raro')
    expect(messages).toEqual([])
  })
})

describe('parseChatFile', () => {
  function file(name: string, content: BlobPart): File {
    return new File([content], name)
  }

  it('lee un .txt plano', async () => {
    const { messages } = await parseChatFile(file('chat.txt', androidEs))

    expect(messages).toHaveLength(3)
  })

  it('lee el .txt que hay adentro de un .zip', async () => {
    const zip = new JSZip()
    zip.file('WhatsApp Chat con Ana.txt', androidEs)
    const blob = await zip.generateAsync({ type: 'arraybuffer' })

    const { messages } = await parseChatFile(file('export.zip', blob))

    expect(messages).toHaveLength(3)
  })

  it('detecta el zip por su firma PK, no por el nombre', async () => {
    const zip = new JSZip()
    zip.file('chat.txt', androidEs)
    const blob = await zip.generateAsync({ type: 'arraybuffer' })

    // El share-target de WhatsApp a veces entrega el archivo sin extensión.
    const { messages } = await parseChatFile(file('adjunto', blob))

    expect(messages).toHaveLength(3)
  })

  it('avisa cuando el zip no trae ningún .txt', async () => {
    const zip = new JSZip()
    zip.file('foto.jpg', new Uint8Array([1, 2, 3]))
    const blob = await zip.generateAsync({ type: 'arraybuffer' })

    await expect(parseChatFile(file('export.zip', blob))).rejects.toThrow(
      'No se encontró un archivo .txt dentro del .zip.',
    )
  })

  it('ignora archivos que no son .txt dentro del zip', async () => {
    const zip = new JSZip()
    zip.file('00000001-PHOTO.jpg', new Uint8Array([1, 2, 3]))
    zip.file('_chat.TXT', androidEs)
    const blob = await zip.generateAsync({ type: 'arraybuffer' })

    const { messages } = await parseChatFile(file('export.zip', blob))

    expect(messages).toHaveLength(3)
  })

  it('no rompe con un archivo vacío', async () => {
    const { messages, sourceHash } = await parseChatFile(file('vacio.txt', ''))

    expect(messages).toEqual([])
    expect(sourceHash).toHaveLength(64)
  })

  it('no confunde un archivo de un solo byte con un zip', async () => {
    const { messages } = await parseChatFile(file('raro.txt', new Uint8Array([0x50])))

    expect(messages).toEqual([])
  })
})

describe('parseChatText — reloj de 12 horas', () => {
  it('parsea el export en inglés con AM/PM', async () => {
    const { messages } = await parse('3/13/25, 9:15 PM - Ana: hola')

    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('Ana')
    expect(new Date(messages[0].timestamp).getHours()).toBe(21)
  })

  it('parsea el AM/PM separado por el espacio angosto de las versiones nuevas', async () => {
    // U+202F escrito como escape a propósito: pegado literal es invisible en el diff.
    const { messages } = await parse('3/13/25, 9:15\u202fPM - Ana: hola')

    expect(new Date(messages[0].timestamp).getHours()).toBe(21)
  })

  it.each([
    ['12:00 AM', 0],
    ['12:30 am', 0],
    ['12:00 PM', 12],
    ['1:00 AM', 1],
    ['9:15 PM', 21],
    ['9:15 pm', 21],
    ['9:15 p.m.', 21],
    ['9:15 p. m.', 21],
    ['11:59 PM', 23],
  ])('convierte %s a la hora %i del reloj de 24', async (time, expected) => {
    const { messages } = await parse(`3/13/25, ${time} - Ana: hola`)

    expect(new Date(messages[0].timestamp).getHours()).toBe(expected)
  })

  it('conserva los segundos junto al meridiano', async () => {
    const { messages } = await parse('3/13/25, 9:15:42 PM - Ana: hola')

    expect(new Date(messages[0].timestamp).getHours()).toBe(21)
    expect(new Date(messages[0].timestamp).getSeconds()).toBe(42)
  })

  it('no rueda al día siguiente ante un dato malformado como "21:15 PM"', async () => {
    // Sin el guard, 21 + 12 = 33, y `new Date` con hora 33 no falla: avanza un día en
    // silencio. La aserción del día es la que caza ese desborde.
    const parsed = new Date((await parse('3/13/25, 21:15 PM - Ana: hola')).messages[0].timestamp)

    expect(parsed.getHours()).toBe(21)
    expect(parsed.getDate()).toBe(13)
  })

  it('un mensaje que empieza con "am" no se confunde con un meridiano', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - Ana: amistad para siempre')

    expect(messages[0].contentText).toBe('amistad para siempre')
  })
})

describe('parseChatText — variantes del separador', () => {
  it('parsea el export de iOS, con corchetes y sin guion', async () => {
    const { messages } = await parse('[13/03/2025, 21:15:00] Ana: hola')

    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('Ana')
    expect(new Date(messages[0].timestamp).getHours()).toBe(21)
  })

  it('parsea iOS en español con reloj de 12 horas', async () => {
    const { messages } = await parse('[3/13/25, 9:15:00 p. m.] Ana: hola')

    expect(messages[0].sender).toBe('Ana')
    expect(new Date(messages[0].timestamp).getHours()).toBe(21)
  })

  it('parsea la variante sin coma entre fecha y hora', async () => {
    // Es el ejemplo textual de Project_Context/03_Procesamiento_Datos_y_Regex.md §1.
    const { messages } = await parse('20/1/2026 15:30 - Juan: Hola, ¿cómo estás?')

    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('Juan')
  })

  it.each([
    '[13/03/2025, 21:15:00]-Ana: hola',
    '[13/03/2025, 21:15:00] -   Ana: hola',
    '[13/03/2025 21:15:00] Ana: hola',
    '13/03/2025,21:15 - Ana: hola',
  ])('sigue reconociendo %j', async (line) => {
    const { messages } = await parse(line)

    expect(messages[0].sender).toBe('Ana')
  })

  it('no se come un guion que es parte del mensaje', async () => {
    const { messages } = await parse('13/03/2025, 21:15 - - guion en el cuerpo')

    expect(messages[0].message).toBe('- guion en el cuerpo')
  })
})

describe('parseChatText — qué NO parte un mensaje en dos', () => {
  it.each([
    '13/03/2025 21:15 hs - confirmado',
    '20/1/2026 15:30 reunion con Juan',
    '12.000 pesos - transferido',
  ])('%j sigue siendo continuación del mensaje anterior', async (second) => {
    const { messages } = await parse(['13/03/2025, 10:00 - Ana: primera', second].join('\n'))

    expect(messages).toHaveLength(1)
    expect(messages[0].message).toContain(second)
  })

  it('una fecha con hora Y guion pegada adentro de un mensaje SÍ lo parte', async () => {
    // Falso positivo aceptado a cambio de soportar la forma sin coma: un chat reenviado y
    // pegado dentro de otro mensaje ahora arranca uno nuevo. Queda explícito para que
    // nadie lo "arregle" sin advertir que rompe el formato sin coma.
    const { messages } = await parse(
      ['13/03/2025, 10:00 - Ana: mira lo que me mandaron', '12/03/2025 20:00 - Beto: hola'].join('\n'),
    )

    expect(messages).toHaveLength(2)
    expect(messages[1].sender).toBe('Beto')
  })

  it('no se traba con una línea larguísima que no llega a ser un mensaje', async () => {
    // Guard de performance: dos `\s*` adyacentes alrededor del grupo del meridiano vuelven
    // la búsqueda cuadrática, y esto corre sobre cada línea del archivo que sube el
    // usuario, en el hilo principal. Medido con la variante ingenua: 526 ms con 16.000
    // espacios. Sin este test, un refactor futuro lo reintroduce sin que nadie lo note.
    const started = performance.now()
    await parse(`13/03/2025, 21:15${' '.repeat(20_000)}x`)

    expect(performance.now() - started).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Formatos declarados FUERA DE ALCANCE — ver "Fuera de alcance" en TESTING.md.
//
// No van como `it.fails` porque no son bugs pendientes sino decisiones: soportarlos
// exigiría tocar también `inferDateOrder` y `parseTimestamp`, y el separador de punto
// choca con el de miles del español. Quedan acá como registro de que se evaluaron.
//
//   13.03.2025, 21:15 - Ana: hola   (locales de/ru/pl/fi)
//   2025-03-13, 21:15 - Ana: hola   (locales zh/sv/hu/lt)
// ---------------------------------------------------------------------------
