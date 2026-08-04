/**
 * Un ícono por métrica, para la placa del modo historia.
 *
 * Vive en el shell de mobile y no en `lib/metrics.ts` porque es una decisión de
 * presentación: el cálculo de una métrica no cambia por tener o no un emoji. Si
 * algún día desktop también los quiere, esto sube a un lugar compartido.
 *
 * Son emojis y no SVG a propósito — es la misma voz que ya usan la landing y el
 * marquee, y no agrega un solo byte de assets.
 */
const METRIC_ICONS: Record<string, string> = {
  // Gratis
  spammer: '🗣️',
  monologuista: '📢',
  reloj: '🕐',
  rompehielo: '🧊',
  emojis: '😂',
  'racha-dias': '🔥',
  testamento: '📜',
  multimedia: '📸',
  'top-dias': '📈',
  velocista: '⚡',
  'heatmap-anual': '🗓️',
  termometro: '🌡️',

  // Pro
  clavavistos: '👀',
  inactividad: '💤',
  wordcloud: '☁️',
  redflags: '🚩',
  cringe: '😬',
  arrepentido: '🗑️',
  poliglota: '🌎',
  jajaja: '😆',
  metralleta: '💥',
  interrogador: '❓',
  dramatico: '🎭',
  tonopicante: '🌶️',
  curador: '🔗',
}

/** Una métrica nueva sin entrada acá no rompe nada: cae en el destello. */
export function metricIcon(metricId: string): string {
  return METRIC_ICONS[metricId] ?? '✨'
}
