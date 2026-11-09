/**
 * Las 25 métricas, tal como se cuentan en `/metricas`.
 *
 * Los nombres y las descripciones salen de `metricMeta` en `src/lib/metrics.ts` (títulos y
 * previews en español). Un test lee ese archivo y falla si acá falta una métrica, sobra una
 * o cambió de gratis a Pro: la página no puede prometer algo que la app no hace.
 */

export interface CatalogMetric {
  /** El mismo id que usa la app: es también el ancla de la página (`/metricas#clavavistos`). */
  id: string
  name: string
  tier: 'free' | 'pro'
  /** Usa IA de Google (Gemini), con el permiso que se pide una sola vez dentro de la app. */
  ai?: true
  summary: string
}

export const METRIC_CATALOG: readonly CatalogMetric[] = [
  {
    id: 'spammer',
    name: 'El Spammer vs El Silencioso',
    tier: 'free',
    summary: 'Quién manda más mensajes: el reparto por integrante y cómo cambió mes a mes.',
  },
  {
    id: 'monologuista',
    name: 'El Monologuista',
    tier: 'free',
    summary: 'Quién manda más mensajes seguidos sin respuesta, con el ranking de rachas y los bloques literales de cada una.',
  },
  {
    id: 'reloj',
    name: 'El Reloj Biológico',
    tier: 'free',
    summary: 'A qué hora está más activo el chat, con un mapa de calor horario para cada integrante.',
  },
  {
    id: 'jajaja',
    name: 'El Jajaja Analítico',
    tier: 'free',
    summary: 'Cómo se ríe el grupo: el reparto de estilos de risa por integrante.',
  },
  {
    id: 'emojis',
    name: 'Guerra de Emojis',
    tier: 'free',
    summary: 'Los emojis más usados del chat, con el top personal de cada integrante.',
  },
  {
    id: 'racha-dias',
    name: 'Días de Racha',
    tier: 'free',
    summary: 'Cuántos días seguidos estuvo activo el chat, en un calendario de rachas que muestra quién participó más.',
  },
  {
    id: 'testamento',
    name: 'El Testamento',
    tier: 'free',
    summary: 'El mensaje más largo del chat y el top 10 de mensajes más largos de cada integrante.',
  },
  {
    id: 'multimedia',
    name: 'El Fan de la Multimedia',
    tier: 'free',
    summary: 'Quién manda más fotos, videos y audios, con una línea de tiempo de los días con más envíos.',
  },
  {
    id: 'poliglota',
    name: 'El Políglota',
    tier: 'free',
    summary: 'Quién mezcla más inglés en la charla y cuáles son los términos importados favoritos de cada integrante.',
  },
  {
    id: 'velocista',
    name: 'El Velocista',
    tier: 'free',
    summary: 'Quién escribe los mensajes más cortos, en un histograma de mensajes cortos, medios y largos.',
  },
  {
    id: 'heatmap-anual',
    name: 'El Pulso del Chat',
    tier: 'free',
    summary: 'Cómo cambió la actividad del chat con el tiempo, con una curva propia para cada integrante.',
  },
  {
    id: 'termometro',
    name: 'Termómetro Semanal',
    tier: 'free',
    summary: 'Qué día de la semana se habla más, en un radar semanal para cada integrante.',
  },
  {
    id: 'arrepentido',
    name: 'El Arrepentido',
    tier: 'free',
    summary: 'Quién borra más mensajes después de mandarlos y cómo evolucionaron los borrados con el tiempo.',
  },
  {
    id: 'personalidades',
    name: 'Quién es Quién',
    tier: 'pro',
    ai: true,
    summary: 'Una personalidad, y la razón, para cada integrante del chat.',
  },
  {
    id: 'redflags',
    name: 'Detector de Red Flags',
    tier: 'pro',
    ai: true,
    summary: 'El desglose de patrones del chat (celos, insultos, culpa, chantaje, borrados, silencios largos) y los momentos señalados.',
  },
  {
    id: 'tonopicante',
    name: 'El Tono Picante',
    tier: 'pro',
    ai: true,
    summary: 'Los mensajes +18 del chat: horarios preferidos, palabras más usadas y los mensajes exactos.',
  },
  {
    id: 'clavavistos',
    name: 'El Clavavistos',
    tier: 'pro',
    summary: 'Quién tarda más en responder, con el historial completo de las peores demoras, con fecha y mensaje.',
  },
  {
    id: 'inactividad',
    name: 'Rachas de Inactividad',
    tier: 'pro',
    summary: 'Los silencios más largos del chat, en una cronología que muestra quién rompió el hielo cada vez.',
  },
  {
    id: 'rompehielo',
    name: 'El Rompehielo',
    tier: 'pro',
    summary: 'Quién arranca la conversación casi siempre, con los porcentajes de apertura y el primer mensaje de cada día.',
  },
  {
    id: 'metralleta',
    name: 'El Metralleta',
    tier: 'pro',
    summary: 'Quién manda ráfagas de mensajes cortos, con los combos más grandes y el bloque literal.',
  },
  {
    id: 'interrogador',
    name: 'El Interrogador',
    tier: 'pro',
    summary: 'Quién pregunta más que el resto, con el reparto de preguntas por integrante.',
  },
  {
    id: 'dramatico',
    name: 'El Dramático',
    tier: 'pro',
    summary: 'Quién escribe más en MAYÚSCULAS, con el top 3 de mensajes más gritados de cada integrante.',
  },
  {
    id: 'top-dias',
    name: 'El Mes Más Intenso',
    tier: 'pro',
    summary: 'El día con más mensajes de toda la historia del chat y el top 10 de días pico, con quién los empujó.',
  },
  {
    id: 'curador',
    name: 'El Curador de Contenidos',
    tier: 'pro',
    summary: 'Quién comparte más videos y links, con las categorías de contenido de cada integrante.',
  },
  {
    id: 'wordcloud',
    name: 'Nube de Palabras Avanzada',
    tier: 'pro',
    summary: 'Las palabras que más se repiten, con una nube personal y un buscador por integrante.',
  },
]

export const FREE_METRICS = METRIC_CATALOG.filter((metric) => metric.tier === 'free')
export const PRO_METRICS = METRIC_CATALOG.filter((metric) => metric.tier === 'pro')
