/**
 * El plugin de Vite que conecta el SEO con el build.
 *
 * - En `index.html`: reemplaza `__SITE_URL__` por el origen público (lo que antes hacía
 *   `siteUrlHtmlPlugin`) y, si hay tokens, suma las etiquetas de verificación de Google
 *   Search Console y de Bing Webmaster Tools.
 * - En el build: escribe las páginas estáticas, `sitemap.xml`, `robots.txt` y `llms.txt` en
 *   `dist/`.
 * - En `npm run dev` y `npm run preview`: sirve esos mismos archivos, así se ven sin
 *   desplegar y sin que el fallback de la SPA los pise.
 */

import type { Connect, HtmlTagDescriptor, Plugin } from 'vite'
import { buildSeoFiles, type EmittedFile } from './render.ts'

export interface SeoPluginOptions {
  /** Origen público sin barra final, o vacío si no se conoce (build local). */
  siteUrl: string
  /** Contenido de `<meta name="google-site-verification">`, si se configuró. */
  googleVerification?: string
  /** Contenido de `<meta name="msvalidate.01">`, si se configuró. */
  bingVerification?: string
  /** El build corre en Vercel: ahí una URL vacía es un error de configuración. */
  onVercel?: boolean
}

export function verificationTags(options: Pick<SeoPluginOptions, 'googleVerification' | 'bingVerification'>): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = []
  const google = options.googleVerification?.trim()
  const bing = options.bingVerification?.trim()

  if (google) {
    tags.push({ tag: 'meta', attrs: { name: 'google-site-verification', content: google }, injectTo: 'head' })
  }
  if (bing) {
    tags.push({ tag: 'meta', attrs: { name: 'msvalidate.01', content: bing }, injectTo: 'head' })
  }

  return tags
}

const CANONICAL_TAG = /^[ \t]*<link rel="canonical"[^>]*>\r?\n?/m

/**
 * Reemplaza `__SITE_URL__` por el origen público.
 *
 * Sin origen (un build local o el de CI) la canónica se saca en vez de dejarla relativa:
 * una canónica tiene que ser absoluta para valer, y con `href="/"` Vite intenta leer la
 * raíz del proyecto como si fuera un archivo y el build se cae con EISDIR.
 */
export function applySiteUrl(html: string, siteUrl: string): string {
  const source = siteUrl ? html : html.replace(CANONICAL_TAG, '')
  return source.split('__SITE_URL__').join(siteUrl)
}

/** `/guias/` y `/guias` son la misma página; la raíz queda como `/`. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

/** Responde las páginas y los archivos del SEO; todo lo demás sigue de largo. */
function serveSeoFiles(files: readonly EmittedFile[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    const pathname = normalizePath(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = files.find((entry) => entry.urls.includes(pathname))
    if (!file) {
      return next()
    }

    res.setHeader('Content-Type', file.contentType)
    res.end(req.method === 'HEAD' ? undefined : file.source)
  }
}

export function seoPlugin(options: SeoPluginOptions): Plugin {
  const { siteUrl } = options
  // Se arma una sola vez: son cadenas, no hay nada que cambie entre pedidos.
  const files = buildSeoFiles(siteUrl)

  return {
    name: 'vistazo-seo',

    buildStart() {
      if (options.onVercel && !siteUrl) {
        this.warn(
          'No se pudo determinar la URL pública del sitio: ni VITE_SITE_URL ni VERCEL_PROJECT_PRODUCTION_URL ' +
            'están definidas. El canónico, el sitemap y las vistas previas van a salir con rutas relativas. ' +
            'Definí VITE_SITE_URL en el proyecto de Vercel o activá "Automatically expose System Environment Variables".',
        )
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler: (html) => ({ html: applySiteUrl(html, siteUrl), tags: verificationTags(options) }),
    },

    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source })
      }
    },

    configureServer(server) {
      server.middlewares.use(serveSeoFiles(files))
    },

    configurePreviewServer(server) {
      server.middlewares.use(serveSeoFiles(files))
    },
  }
}
