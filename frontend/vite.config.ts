import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const keyPath = fileURLToPath(new URL('./.cert/localhost-key.pem', import.meta.url))
const certPath = fileURLToPath(new URL('./.cert/localhost-cert.pem', import.meta.url))

// Locally-trusted cert (via mkcert, see README) so Chrome treats dev the same way it'll
// treat production over a real domain — payment-autofill warnings included. Falls back to
// plain HTTP automatically on any machine that hasn't generated the cert.
const hasLocalCert = existsSync(keyPath) && existsSync(certPath)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: hasLocalCert
      ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
      : undefined,
  },
})
