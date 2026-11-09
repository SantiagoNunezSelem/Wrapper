/**
 * Lo fijo del SEO del sitio, en un solo lugar.
 *
 * Qué entra al sitemap, qué bloquea `robots.txt` y qué lleva `noindex` en `vercel.json` se
 * decide con estas listas, y un test cruza `vercel.json` contra ellas: si alguien agrega una
 * página o una ruta privada y se olvida de uno de los tres lugares, el test lo avisa.
 */

export const SITE_NAME = 'Vistazo'

/** `og:locale` de las páginas. El producto nació en Argentina y habla en voseo. */
export const SITE_LOCALE = 'es_AR'

export const THEME_COLOR = '#f6f2e8'

/** 1200×630 y menos de 300 KB: por encima WhatsApp no dibuja la vista previa. */
export const OG_IMAGE_PATH = '/og-image.jpg'

export const LOGO_PATH = '/icon-512.png'

/**
 * Rutas de la SPA que van al sitemap. Sólo la portada: el resto de la app (cuenta, ayuda,
 * términos, recorridos compartidos) sirve el mismo `index.html`, que declara como canónica
 * a la portada, así que listarlas sería contradecirse.
 */
export const APP_INDEXABLE_PATHS: readonly string[] = ['/']

/** Cuándo cambió por última vez algo visible en la portada (`lastmod` del sitemap). */
export const APP_PAGES_UPDATED = '2026-11-09'

/**
 * Rutas que ningún buscador tiene que rastrear: pantallas de cuenta, el panel de admin y el
 * receptor del share-target. Van a `robots.txt`.
 */
export const DISALLOWED_PATHS: readonly string[] = ['/admin', '/suscripcion', '/share-target/']

/**
 * Rutas que se sirven (el rastreo es libre) pero con `X-Robots-Tag: noindex`, en
 * `vercel.json`. `/s/{slug}` es la clave: son recorridos que alguien compartió, con datos de
 * su chat, y no deben aparecer en Google. No se bloquean en `robots.txt` a propósito: los
 * rastreadores de vistas previas (WhatsApp, Facebook, X) tienen que poder abrirlos para
 * dibujar la tarjeta, que es el bucle central del producto.
 */
export const NOINDEX_SOURCES: readonly string[] = ['/s/:slug', '/admin', '/admin/:path*', '/suscripcion', '/ayuda']

/**
 * El origen público del sitio, sin barra final.
 *
 * Orden: `VITE_SITE_URL` (a mano, para forzar uno) y después el dominio de producción que
 * Vercel expone en cada build (`VERCEL_PROJECT_PRODUCTION_URL`, sin protocolo: es el
 * dominio propio más corto, o el `.vercel.app` si no hay ninguno). Así, conectar un dominio
 * propio actualiza el canónico, el sitemap y las vistas previas sin tocar nada. Vacío en
 * local, donde las URLs relativas son lo correcto.
 */
export function resolveSiteUrl(explicit: string | undefined, vercelHost: string | undefined): string {
  const fromEnv = explicit?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '')
  }

  const host = vercelHost?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return host ? `https://${host}` : ''
}

/** `siteUrl` no lleva barra final y `path` empieza con `/`, así que alcanza con unirlos. */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl}${path}`
}
