import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { seoPlugin } from './seo/plugin.ts'
import { resolveSiteUrl } from './seo/site.ts'

const keyPath = fileURLToPath(new URL('./.cert/localhost-key.pem', import.meta.url))
const certPath = fileURLToPath(new URL('./.cert/localhost-cert.pem', import.meta.url))

// Locally-trusted cert (via mkcert, see README) so Chrome treats dev the same way it'll
// treat production over a real domain — payment-autofill warnings included. Falls back to
// plain HTTP automatically on any machine that hasn't generated the cert.
const hasLocalCert = existsSync(keyPath) && existsSync(certPath)

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [
      react(),
      // Todo el SEO sale de `seo/`: el origen público (que reemplaza `__SITE_URL__` en
      // `index.html`: canónico, vistas previas y datos estructurados), las páginas de
      // contenido, el sitemap y el robots.txt. `VITE_SITE_URL` fuerza un origen; sin ella
      // se usa el dominio de producción que Vercel expone en cada build, y en local queda
      // vacío (rutas relativas, que es lo correcto).
      seoPlugin({
        siteUrl: resolveSiteUrl(env.VITE_SITE_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL),
        googleVerification: env.VITE_GOOGLE_SITE_VERIFICATION,
        bingVerification: env.VITE_BING_SITE_VERIFICATION,
        onVercel: Boolean(process.env.VERCEL),
      }),
    ],
    server: {
      https: hasLocalCert
        ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
        : undefined,
    },
  }
})
