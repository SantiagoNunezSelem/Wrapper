import { requestNoContent } from './api'
import { getDeviceId } from './deviceId'

/*
 * Las campañas de QR. Un folleto lleva un link `/q/{código}`: al abrirlo, el código se
 * guarda acá, se avisa la visita y la barra de direcciones queda en `/` como si nada. Si esa
 * persona después crea su cuenta, el login manda el código y la cuenta queda atribuida.
 */

const storageKey = 'vistazo-campaign'

/** Pasado esto, el folleto ya no es lo que la trajo: un registro meses después no se le atribuye. */
const maxAgeMs = 30 * 24 * 60 * 60 * 1000

const pathPattern = /^\/q\/([a-z0-9]{4,16})\/?$/i

/** El código de un path `/q/{código}`, o null. */
export function readCampaignPath(pathname: string): string | null {
  const match = pathPattern.exec(pathname)
  return match ? match[1].toLowerCase() : null
}

/**
 * Se llama una vez, antes de dibujar la app: si se entró por un link de campaña, guarda el
 * código, cambia la URL a la página principal (conservando lo demás de la URL) y avisa la
 * visita sin esperar la respuesta. Devuelve el código, para los tests.
 */
export function captureCampaignFromLocation(): string | null {
  const code = readCampaignPath(window.location.pathname)
  if (!code) {
    return null
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify({ code, at: Date.now() }))
  } catch {
    // Sin almacenamiento la visita cuenta igual; sólo se pierde la atribución del registro.
  }

  window.history.replaceState(window.history.state, '', `/${window.location.search}${window.location.hash}`)

  void requestNoContent('/api/campaigns/visit', {
    method: 'POST',
    body: JSON.stringify({ code, deviceId: getDeviceId() }),
  }).catch(() => {
    // Una visita que no se pudo contar no tiene por qué molestar a quien está entrando.
  })

  return code
}

/** El código guardado si todavía está vigente, para mandarlo con el login. */
export function readStoredCampaign(): string | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown }
    if (typeof parsed.code !== 'string' || typeof parsed.at !== 'number' || Date.now() - parsed.at > maxAgeMs) {
      localStorage.removeItem(storageKey)
      return null
    }

    return parsed.code
  } catch {
    return null
  }
}

/**
 * Después de un login: la campaña ya se usó (o la cuenta ya existía), así que otra cuenta
 * que entre después desde el mismo navegador no se le atribuye.
 */
export function clearStoredCampaign(): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // Nada que limpiar.
  }
}
