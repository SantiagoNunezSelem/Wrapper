// Antes de cualquier otra cosa: fija la zona horaria del runner.
//
// Media app formatea fechas con `Intl` sobre timestamps locales, y varias métricas
// bucketean el día a partir de las 6am de la hora local. Sin fijarla, la misma
// aserción da un resultado en la máquina de desarrollo (UTC-3) y otro en el runner de
// GitHub (UTC), y los tests se vuelven una lotería según quién los corra. Se elige la
// zona del público real del producto, que además es la que expone los bugs de
// desplazamiento de un día en vez de taparlos.
process.env.TZ = 'America/Argentina/Buenos_Aires'

import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Configuración de tests separada de `vite.config.ts` a propósito: esa lee el
 * certificado local para levantar el dev server por HTTPS, y nada de eso hace falta
 * (ni existe) dentro del runner ni en CI.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))],
    include: ['src/**/*.test.{ts,tsx}'],
    // El worker de análisis y el service worker no se cargan nunca en jsdom; los tests
    // que los tocan los mockean explícitamente.
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      // `json-summary` es el que lee scripts/coverage-gate.mjs para el resumen del PR;
      // `lcov` queda para poder abrir el detalle en el navegador.
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/types.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // Sólo strings de copy y paletas: no hay lógica que un test pueda romper.
        'src/copy/**',
        'src/assets/**',
        'src/components/charts/palette.ts',
      ],
      // Umbrales por zona: exigente donde vive la lógica de negocio, laxo en la capa
      // de presentación. El número global evita que la cobertura se degrade sola.
      //
      // Cada valor está unos puntos por debajo de lo que la suite mide hoy: suficiente
      // margen para que un refactor honesto no rompa el PR, suficiente presión para que
      // borrar tests sí lo rompa. El global es bajo a propósito — el alcance acordado no
      // incluye renderizar los ~40 componentes y los dos shells, así que subirlo sólo
      // invitaría a escribir tests de UI decorativos para llegar al número.
      thresholds: {
        lines: 50,
        functions: 45,
        statements: 50,
        branches: 40,
        // La lógica de negocio de verdad: parser, las 24 métricas, candidatos de IA,
        // cliente HTTP, recorte de lo que se publica. Hoy: 98.3 / 98.2 / 99.0 / 91.4.
        'src/lib/**': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 88,
        },
        // La única rama sin cubrir es la guarda de SSR (`typeof window === 'undefined'`),
        // inalcanzable dentro de jsdom. Las líneas sí están al 100%.
        'src/app/useIsMobile.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 50,
        },
      },
    },
  },
})
