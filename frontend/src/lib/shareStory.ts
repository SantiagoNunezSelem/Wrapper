import type { MessageGroup, MetricCard } from '../types'

/**
 * Un recorrido publicado, tal como lo devuelve `GET /api/shares/{slug}`.
 *
 * Es una foto congelada: refleja lo que el usuario podía ver en el momento de
 * compartir —métricas Pro, desbloqueos gratuitos del día y todo— y no cambia
 * después. Perder Pro más adelante no vacía un link que ya está circulando.
 */
export interface SharedStoryPayload {
  chatName: string
  dateRangeLabel: string
  messageCount: number
  participantCount: number
  /** El idioma en que se generaron las etiquetas. Ya vienen traducidas dentro de
   * las tarjetas, así que la página pública se muestra en ESTE idioma y no en el
   * del visitante — mezclarlos dejaría títulos en un idioma y datos en otro. */
  language: 'es' | 'en'
  createdAtUtc: string
  expiresAtUtc: string
  cards: SharedCard[]
}

/** El encabezado de un grupo de mensajes, sin sus `bubbles`: es lo único de `groups`
 * que sale del navegador (ver `toSharedCard`). Alcanza para dibujar el contenedor
 * cerrado en el link compartido; el contenido real queda detrás del aviso de
 * privacidad (`isSharedStory` en `MessageGroupItem`). */
export type SharedMessageGroupHeading = Pick<MessageGroup, 'id' | 'heading'>

/** Una tarjeta publicable: `MetricCard` sin lo privado ni lo que deja de tener
 * sentido una vez congelado (`preview` y `ai` describen estados de bloqueo o
 * espera, y una tarjeta compartida no está en ninguno de los dos). */
export type SharedCard = Pick<MetricCard, 'id' | 'title' | 'description' | 'tier' | 'accent'> & {
  basic?: Omit<NonNullable<MetricCard['basic']>, 'note'>
  detail?: Omit<NonNullable<MetricCard['detail']>, 'groups'> & {
    groups?: SharedMessageGroupHeading[]
  }
}

/**
 * Deja una tarjeta lista para publicarse, sacándole el texto literal de mensajes.
 *
 * Son exactamente dos campos, y conviene tenerlos nombrados:
 *
 * - `basic.note`, que en "El Testamento" es el mensaje más largo del chat citado
 *   textualmente (ver metricTestamento en lib/metrics.ts);
 * - `detail.groups[].bubbles`, las burbujas estilo WhatsApp —con los mensajes de
 *   alrededor como contexto— que usan varias métricas.
 *
 * Publicar eso expondría conversaciones de gente que nunca aceptó nada, así que
 * ni siquiera salen del navegador: se recortan acá, antes de enviar. El backend
 * vuelve a recortarlos por su cuenta (ver SharePayloadSanitizer.cs) — esto no lo
 * reemplaza, lo complementa: uno evita transmitirlos, el otro evita publicarlos
 * aunque alguien manipule el cliente.
 *
 * El `heading` de cada grupo sí viaja (sin sus `bubbles`): es lo que deja mostrar
 * el contenedor cerrado en el link compartido, con el aviso de privacidad al
 * tocarlo en vez del contenido real.
 */
export function toSharedCard(card: MetricCard): SharedCard {
  const shared: SharedCard = {
    id: card.id,
    title: card.title,
    description: card.description,
    tier: card.tier,
    accent: card.accent,
  }

  if (card.basic) {
    const { note: _omitted, ...safeBasic } = card.basic
    shared.basic = safeBasic
  }

  if (card.detail) {
    const { groups, ...safeDetail } = card.detail
    shared.detail = {
      ...safeDetail,
      groups: groups?.map(({ id, heading }) => ({ id, heading })),
    }
  }

  return shared
}

/**
 * Las tarjetas que van al link: sólo las que el usuario realmente puede ver.
 *
 * Es el mismo filtro que usa el recorrido en pantalla (ver `visible` en
 * StoryMode) y no es casual — compartir tiene que producir lo que el usuario
 * acaba de mirar, ni más ni menos. Una tarjeta bloqueada no tiene número que
 * mostrar, y una esperando a la IA todavía no tiene veredicto.
 */
export function buildSharePayload(metrics: MetricCard[]): SharedCard[] {
  return metrics
    .filter((card) => card.basic && !(card.ai && card.ai.status !== 'ready'))
    .map(toSharedCard)
}

/** Devuelve el slug si la URL es la de un recorrido compartido, o `null`. */
export function readShareSlug(pathname: string): string | null {
  const match = /^\/s\/([A-Za-z0-9]+)\/?$/.exec(pathname)
  return match ? match[1] : null
}

/** La URL pública de un recorrido, armada contra el origen actual — así el mismo
 * código sirve en localhost, en preview y en producción sin configurar nada. */
export function shareUrlFor(slug: string): string {
  return `${window.location.origin}/s/${slug}`
}
