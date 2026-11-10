import type { Language, MetricCard } from '../types'
import { buildLandingSampleChat, landingSampleChatName } from './landingSample'
import { computeAnalysisCore, gateAnalysis, PROFILE_METRIC_ID } from './metrics'
import { parseChatText } from './parser'

/**
 * Las métricas que se muestran de ejemplo en la landing, en este orden.
 *
 * Son las cinco Pro que más se explican solas, y todas traen algo para leer adentro: los
 * mensajes que explican el número (`detail.groups`) o, en la personalidad, el perfil de
 * cada integrante (`detail.profiles`). Es lo que el visitante después va a buscar en su chat.
 */
export const landingPreviewMetricIds = [
  'personalidades',
  'redflags',
  'tonopicante',
  'rompehielo',
  // Con el chat de ejemplo bien guionado (ver `landingSample.ts`): sin eso sus peores
  // demoras eran los saltos entre un día y otro, y el detalle terminaba mostrando "Nico
  // tardó 6 días" sin ninguna conversación detrás.
  'clavavistos',
] as const

/** Prefijo de los ids de ejemplo: un id compartido con una métrica real haría que un
 * desbloqueo gratuito de la landing "abriera" la métrica real, o al revés. */
export const demoIdPrefix = 'demo-'

/**
 * Tarjetas de ejemplo para la landing, calculadas con las métricas reales sobre un
 * chat inventado (ver `landingSample.ts`) — así nunca quedan desfasadas de lo que el
 * dashboard muestra de verdad.
 *
 * Se abren sin candado: con acceso Pro simulado y las tres tarjetas que esperan a la IA
 * marcadas como resueltas. Sin veredicto de la IA, `metricRedflags` y `metricTonoPicante`
 * muestran todos los candidatos del diccionario, que en un chat inventado son justamente
 * los que se escribieron para eso, y la personalidad muestra la lectura que hace el
 * navegador con los números del chat. Bloquear un ejemplo inventado detrás de "Desbloquear
 * Pro" antes de que el visitante haya subido nada no tendría sentido.
 *
 * Es CPU pura (un chat de ~300 mensajes): la app la corre en el worker de análisis
 * (ver `landingPreviewInWorker`), no en el hilo principal.
 */
export async function buildLandingPreviewCards(language: Language): Promise<MetricCard[]> {
  const parsed = await parseChatText(buildLandingSampleChat(language))
  const core = await computeAnalysisCore(landingSampleChatName(language), parsed.messages, language, parsed.sourceHash)
  const bundle = gateAnalysis(core, true, {
    redflags: { status: 'ready' },
    tonopicante: { status: 'ready' },
    [PROFILE_METRIC_ID]: { status: 'ready' },
  })
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
