import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const keyPath = fileURLToPath(new URL('./.cert/localhost-key.pem', import.meta.url))
const certPath = fileURLToPath(new URL('./.cert/localhost-cert.pem', import.meta.url))

// Locally-trusted cert (via mkcert, see README) so Chrome treats dev the same way it'll
// treat production over a real domain — payment-autofill warnings included. Falls back to
// plain HTTP automatically on any machine that hasn't generated the cert.
const hasLocalCert = existsSync(keyPath) && existsSync(certPath)

/**
 * Reemplaza `__SITE_URL__` en `index.html` por el origen público del sitio.
 *
 * Existe por las etiquetas Open Graph: los crawlers que arman la vista previa de un
 * link (WhatsApp, entre otros) quieren una URL absoluta para la imagen, y el origen
 * no se conoce hasta el deploy. Con `VITE_SITE_URL` definido queda absoluta; sin ella
 * el marcador se borra y la ruta cae a relativa, que es lo correcto en local.
 */
function siteUrlHtmlPlugin(siteUrl: string): Plugin {
  const normalized = siteUrl.replace(/\/+$/, '')

  return {
    name: 'vistazo-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.split('__SITE_URL__').join(normalized),
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), siteUrlHtmlPlugin(env.VITE_SITE_URL ?? '')],
    server: {
      https: hasLocalCert
        ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
        : undefined,
    },
  }
})
