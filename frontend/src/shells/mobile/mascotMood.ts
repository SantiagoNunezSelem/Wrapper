export type MascotMood = 'calm' | 'spicy' | 'nosy'

/** Métricas que rozan tensión o incomodidad — desencuentros, silencios,
 * cosas que se dijeron y se borraron. */
const SPICY_IDS = new Set([
  'monologuista',
  'termometro',
  'clavavistos',
  'inactividad',
  'redflags',
  'arrepentido',
  'dramatico',
  'tonopicante',
])

/** Métricas juguetonas o expresivas — de qué se ríen, qué dicen, quién
 * pregunta de más. */
const NOSY_IDS = new Set(['rompehielo', 'emojis', 'jajaja', 'wordcloud', 'interrogador', 'metralleta', 'curador'])

/**
 * Qué humor le pone el personaje de Story Mode a la métrica que se está
 * mirando (ver MascotBlob). Es una lectura editorial de `metrics.ts`, no un
 * dato que devuelva el cálculo — por eso vive en el shell de mobile, y no
 * ahí. Ante una métrica nueva sin categorizar, cae en "tranqui" en vez de
 * forzar un humor que no le queda.
 */
export function mascotMoodFor(metricId: string): MascotMood {
  if (SPICY_IDS.has(metricId)) {
    return 'spicy'
  }
  if (NOSY_IDS.has(metricId)) {
    return 'nosy'
  }
  return 'calm'
}
