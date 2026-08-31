import type { Language, MetricCard } from '../types'

/**
 * Fabricated example cards shown only on the landing page, before any chat is
 * uploaded — so a visitor can see exactly what the real dashboard looks like.
 * The numbers, names and quotes here are made up on purpose; they never come from
 * a real chat, including the sample exports used for local testing.
 *
 * Every card ships its own `basic` AND `detail` data — even the VIP-tinted ones —
 * so nothing here is ever rendered as locked. Gating a made-up example behind
 * "Unlock VIP" would make no sense before a visitor has even uploaded a chat.
 */
export function getLandingPreviewCards(language: Language): MetricCard[] {
  const es = language === 'es'

  return [
    {
      id: 'demo-monologuista',
      title: es ? 'Quién manda más mensajes seguidos sin respuesta' : 'Who sends the most messages in a row without a reply',
      description: es ? 'El Monologuista' : 'The Monologuist',
      tier: 'free',
      accent: 'tier-pink',
      hasData: true,
      basic: {
        value: '9',
        label: es ? 'mensajes seguidos de Fran sin respuesta' : 'messages in a row from Fran with no reply',
        note: es ? '"dale, contestame algo 😩"' : '"come on, answer something 😩"',
        chart: {
          kind: 'bar',
          items: [
            { label: 'Fran', value: 9, displayValue: '9' },
            { label: 'Vale', value: 4, displayValue: '4' },
            { label: 'Nico', value: 2, displayValue: '2' },
          ],
        },
      },
      detail: {
        intro: es
          ? 'Así se ve el desglose por integrante, con la racha real detrás del número.'
          : "Here's the per-participant breakdown, with the real streak behind the number.",
        breakdown: [
          { name: 'Fran', value: 9, displayValue: '9' },
          { name: 'Vale', value: 4, displayValue: '4' },
          { name: 'Nico', value: 2, displayValue: '2' },
        ],
        groups: [
          {
            id: 'demo-group-monologuista',
            heading: es ? 'Fran encadenó 9 mensajes:' : 'Fran chained 9 messages:',
            bubbles: [
              { sender: 'Vale', text: es ? '¿todo bien?' : 'you good?', timestampLabel: es ? '22:41' : '10:41 PM', isHighlight: false },
              { sender: 'Fran', text: es ? 'sisi todo bien' : 'yeah all good', timestampLabel: es ? '22:42' : '10:42 PM', isHighlight: true },
              {
                sender: 'Fran',
                text: es ? 'te cuento algo loco que pasó' : 'gotta tell you something crazy',
                timestampLabel: es ? '22:42' : '10:42 PM',
                isHighlight: true,
              },
              {
                sender: 'Fran',
                text: es ? 'no vas a creer a quién vi hoy' : "you won't believe who I saw today",
                timestampLabel: es ? '22:43' : '10:43 PM',
                isHighlight: true,
              },
              {
                sender: 'Fran',
                text: es ? 'bueno, después te cuento jaja' : "anyway, I'll tell you later lol",
                timestampLabel: es ? '22:47' : '10:47 PM',
                isHighlight: true,
              },
            ],
          },
        ],
        groupsLabel: es ? 'La racha en vivo' : 'The streak, live',
      },
      preview: es ? 'Ranking de rachas y los bloques literales de cada una.' : 'Streak ranking and the literal blocks behind each one.',
    },
    {
      id: 'demo-reloj',
      title: es ? 'A qué hora está más activo el chat' : 'What time of day the chat is most active',
      description: es ? 'El Reloj Biológico' : 'The Body Clock',
      tier: 'free',
      accent: 'tier-orange',
      hasData: true,
      basic: {
        value: es ? 'Hora pico: Noche' : 'Peak hour: Night',
        label: es ? '134 mensajes de madrugada o noche' : '134 late-night messages',
        chart: {
          kind: 'hourHeatmap',
          hours: [18, 12, 6, 3, 2, 1, 2, 4, 6, 8, 9, 10, 11, 10, 9, 8, 9, 10, 12, 16, 22, 28, 34, 26],
        },
      },
      detail: {
        intro: es
          ? 'Heatmap horario propio para cada integrante: quién es búho y quién madruga.'
          : "Each participant's own hourly heatmap: who's the night owl and who's the early bird.",
        series: [
          {
            name: 'Fran',
            chart: {
              kind: 'hourHeatmap',
              hours: [22, 16, 9, 4, 2, 1, 1, 2, 3, 4, 5, 6, 7, 6, 5, 5, 6, 7, 9, 14, 20, 30, 38, 30],
            },
          },
          {
            name: 'Vale',
            chart: {
              kind: 'hourHeatmap',
              hours: [6, 4, 2, 1, 1, 1, 3, 6, 10, 14, 16, 17, 16, 15, 14, 13, 13, 14, 12, 10, 8, 6, 5, 4],
            },
          },
        ],
      },
      preview: es ? 'Heatmap horario individual de cada integrante.' : "Each participant's own hourly heatmap.",
    },
    {
      id: 'demo-wordcloud',
      title: es ? 'Las palabras que más se repiten' : 'The words that come up the most',
      description: es ? 'Nube de Palabras Avanzada' : 'Advanced Word Cloud',
      tier: 'vip',
      accent: 'tier-cyan',
      hasData: true,
      basic: {
        value: es ? 'jajaja' : 'literally',
        label: es ? 'la palabra más repetida (41 veces)' : 'the most repeated word (41 times)',
        chart: {
          kind: 'wordCloud',
          words: es
            ? [
                { word: 'jajaja', count: 41 },
                { word: 'obvio', count: 29 },
                { word: 'posta', count: 24 },
                { word: 'dale', count: 22 },
                { word: 'boludo', count: 19 },
                { word: 'viste', count: 17 },
                { word: 'igual', count: 15 },
                { word: 'onda', count: 13 },
                { word: 'mira', count: 12 },
                { word: 'increible', count: 10 },
                { word: 'capaz', count: 9 },
                { word: 'tremendo', count: 8 },
              ]
            : [
                { word: 'literally', count: 38 },
                { word: 'honestly', count: 27 },
                { word: 'vibes', count: 24 },
                { word: 'lowkey', count: 21 },
                { word: 'actually', count: 18 },
                { word: 'crazy', count: 16 },
                { word: 'deadass', count: 14 },
                { word: 'bestie', count: 12 },
                { word: 'iconic', count: 10 },
                { word: 'obsessed', count: 9 },
                { word: 'ngl', count: 8 },
                { word: 'fr', count: 7 },
              ],
        },
      },
      detail: {
        intro: es
          ? 'Nube personal por integrante, con un buscador para ver quién repite más una palabra puntual.'
          : "A personal cloud per participant, with a search box to see who repeats a given word the most.",
        series: [
          {
            name: 'Fran',
            chart: {
              kind: 'wordCloud',
              words: es
                ? [
                    { word: 'jajaja', count: 26 },
                    { word: 'boludo', count: 15 },
                    { word: 'onda', count: 9 },
                    { word: 'posta', count: 8 },
                  ]
                : [
                    { word: 'literally', count: 22 },
                    { word: 'bro', count: 14 },
                    { word: 'crazy', count: 9 },
                    { word: 'fr', count: 7 },
                  ],
            },
          },
          {
            name: 'Vale',
            chart: {
              kind: 'wordCloud',
              words: es
                ? [
                    { word: 'obvio', count: 19 },
                    { word: 'dale', count: 14 },
                    { word: 'viste', count: 11 },
                    { word: 'igual', count: 8 },
                  ]
                : [
                    { word: 'honestly', count: 17 },
                    { word: 'vibes', count: 13 },
                    { word: 'bestie', count: 9 },
                    { word: 'ngl', count: 6 },
                  ],
            },
          },
        ],
      },
      preview: es ? 'Nube personal y buscador por integrante.' : 'Personal cloud and search per participant.',
    },
    {
      id: 'demo-jajaja',
      title: es ? 'Cómo se ríe más el grupo' : 'How the group laughs the most',
      description: es ? 'El Jajaja Analítico' : 'The Laugh Analyzer',
      tier: 'free',
      accent: 'tier-yellow',
      hasData: true,
      basic: {
        value: 'Jajaja',
        label: es ? 'es el estilo de risa dominante (56 veces)' : 'is the dominant laugh style (56 times)',
        chart: {
          kind: 'bar',
          items: [
            { label: 'Jajaja', value: 56, displayValue: '56' },
            { label: 'Jsjsjs', value: 31, displayValue: '31' },
            { label: 'XD', value: 18, displayValue: '18' },
            { label: es ? 'Ataque de risa ("askjdh")' : 'Laughing fit ("askjdh")', value: 7, displayValue: '7' },
          ],
        },
      },
      detail: {
        intro: es
          ? 'De la risa más simple a la más caótica: así se rompe por integrante.'
          : 'From a simple laugh to full keyboard chaos: broken down per participant.',
        breakdown: [
          { name: 'Fran', value: 33, displayValue: 'Jajaja' },
          { name: 'Vale', value: 21, displayValue: 'Jsjsjs' },
          { name: 'Nico', value: 7, displayValue: es ? 'Ataque de risa ("askjdh")' : 'Laughing fit ("askjdh")' },
        ],
      },
      preview: es ? 'Distribución de estilos de risa por integrante.' : "Each participant's laugh-style breakdown.",
    },
    {
      id: 'demo-redflags',
      title: es ? 'Qué tan tensa está la conversación' : 'How tense the conversation gets',
      description: es ? 'Detector de Red Flags' : 'Red Flag Detector',
      tier: 'vip',
      accent: 'tier-red',
      hasData: true,
      basic: {
        value: '38/100',
        label: es ? 'puntuación heurística de tensión' : 'heuristic tension score',
        chart: {
          kind: 'donut',
          items: es
            ? [
                { label: 'Celos y control', value: 5 },
                { label: 'Insultos', value: 2 },
                { label: 'Silencios largos', value: 4 },
                { label: 'Borrados', value: 3 },
              ]
            : [
                { label: 'Jealousy & control', value: 5 },
                { label: 'Insults', value: 2 },
                { label: 'Long silences', value: 4 },
                { label: 'Deletions', value: 3 },
              ],
        },
      },
      detail: {
        intro: es
          ? 'No es un diagnóstico: cruza silencios largos, borrados y frases clave agrupadas por categoría.'
          : 'Not a diagnosis: it combines long silences, deletions, and keyword phrases grouped by category.',
        breakdown: [
          { name: 'Fran', value: 8, displayValue: es ? '8 señales' : '8 signals' },
          { name: 'Vale', value: 6, displayValue: es ? '6 señales' : '6 signals' },
        ],
      },
      preview: es ? 'Desglose de patrones y momentos señalados.' : 'Pattern breakdown and flagged moments.',
    },
    {
      id: 'demo-tonopicante',
      title: es ? 'Quién manda los mensajes más subidos de tono' : 'Who sends the most suggestive messages',
      description: es ? 'El Tono Picante' : 'The Spicy Tone',
      tier: 'vip',
      accent: 'tier-magenta',
      hasData: true,
      basic: {
        value: '14',
        label: es ? 'mensajes subidos de tono de Vale' : 'spicy messages from Vale',
        chart: {
          kind: 'bar',
          items: [
            { label: 'Vale', value: 14, displayValue: '70%' },
            { label: 'Fran', value: 6, displayValue: '30%' },
          ],
        },
      },
      detail: {
        intro: es
          ? 'Horarios preferidos del grupo, los mensajes exactos de cada uno y las palabras más usadas.'
          : "The group's preferred hours, each participant's exact messages, and the words used most.",
        breakdown: [
          { name: 'Vale', value: 70, displayValue: '70%' },
          { name: 'Fran', value: 30, displayValue: '30%' },
        ],
        paginatedItems: es
          ? ['"caliente" se usó 6 veces', '"fuego" se usó 4 veces', '"picante" se usó 3 veces']
          : ['"hot" used 6 times', '"turned on" used 4 times', '"naughty" used 3 times'],
        paginatedItemsLabel: es ? 'Palabras más usadas' : 'Most used words',
      },
      preview: es
        ? 'Horarios preferidos, palabras más usadas y los mensajes exactos.'
        : 'Preferred hours, the most used words, and the exact messages.',
    },
  ]
}
