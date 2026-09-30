import type { Language, MetricCard } from '../types'
import { buildLandingSampleChat, landingSampleChatName } from './landingSample'
import { computeAnalysisCore, gateAnalysis } from './metrics'
import { parseChatText } from './parser'

/**
 * Las métricas que se muestran de ejemplo en la landing, en este orden.
 *
 * Todas tienen detalle con mensajes adentro (`detail.groups`): el visitante abre una y
 * ve los mensajes que explican el número, que es lo que después va a buscar en su chat.
 * Se intercalan gratis y Pro como en el dashboard real.
 */
export const landingPreviewMetricIds = [
  'monologuista',
  // No "clavavistos": en un chat de ejemplo sus peores demoras son los saltos entre un
  // día y otro, y el detalle terminaba mostrando "Nico tardó 6 días" sin ninguna
  // conversación detrás.
  'dramatico',
  'testamento',
  'redflags',
  'rompehielo',
  'tonopicante',
] as const

/** Prefijo de los ids de ejemplo: un id compartido con una métrica real haría que un
 * desbloqueo gratuito de la landing "abriera" la métrica real, o al revés. */
export const demoIdPrefix = 'demo-'

/**
 * Tarjetas de ejemplo para la landing, calculadas con las métricas reales sobre un
 * chat inventado (ver `landingSample.ts`) — así nunca quedan desfasadas de lo que el
 * dashboard muestra de verdad.
 *
 * Se abren sin candado: con acceso Pro simulado y las dos métricas con IA marcadas como
 * resueltas. Sin veredicto de la IA, `metricRedflags` y `metricTonoPicante` muestran
 * todos los candidatos del diccionario, que en un chat inventado son justamente los que
 * se escribieron para eso. Bloquear un ejemplo inventado detrás de "Desbloquear Pro"
 * antes de que el visitante haya subido nada no tendría sentido.
 *
 * Es CPU pura (un chat de ~1.600 mensajes): la app la corre en el worker de análisis
 * (ver `landingPreviewInWorker`), no en el hilo principal.
 */
export async function buildLandingPreviewCards(language: Language): Promise<MetricCard[]> {
  const parsed = await parseChatText(buildLandingSampleChat(language))
  const core = await computeAnalysisCore(landingSampleChatName(language), parsed.messages, language, parsed.sourceHash)
  const bundle = gateAnalysis(core, true, { redflags: { status: 'ready' }, tonopicante: { status: 'ready' } })
  const byId = new Map([...bundle.freeMetrics, ...bundle.vipMetrics].map((card) => [card.id, card]))

  return landingPreviewMetricIds.flatMap((id) => {
    const card = byId.get(id)
    if (!card) {
      return []
    }
    // `ai` fuera: la tarjeta no espera a nadie, y con él presente la UI dibujaría el
    // estado de la IA en vez del número.
    const { ai: _ai, ...rest } = card
    return [{ ...rest, id: `${demoIdPrefix}${id}` }]
  })
}
