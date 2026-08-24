#!/usr/bin/env node
/**
 * Portero de cobertura y generador del resumen del PR.
 *
 * Existe por dos cosas que las herramientas de cada stack no hacen solas:
 *
 *  1. **Umbrales por zona en el backend.** `coverlet` sabe fallar por un número global,
 *     pero no por carpeta, y un global es justo la métrica que se puede maquillar
 *     testeando lo fácil. Acá la lógica de negocio (`Services/`) y la superficie HTTP
 *     (`Endpoints/`) tienen su propia vara, más alta que el promedio.
 *     El frontend ya tiene sus umbrales por zona en `vitest.config.ts`; este script sólo
 *     lo lee para el informe.
 *
 *  2. **El resumen que se ve en el PR.** Escribe una tabla en `$GITHUB_STEP_SUMMARY`, que
 *     es la forma de mostrar el estado de la cobertura sin depender de Codecov ni de
 *     ningún token.
 *
 * Uso: node scripts/coverage-gate.mjs [--report-only]
 */

import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const REPORT_ONLY = process.argv.includes('--report-only')

/**
 * Umbrales del backend. Cada uno está unos puntos por debajo de lo que la suite mide
 * hoy: margen suficiente para que un refactor honesto no rompa el PR, presión suficiente
 * para que borrar tests sí lo rompa.
 */
// Ojo con los `match`: en el Cobertura de coverlet, `filename` es RELATIVO al `<source>`
// del encabezado (queda "Services/TokenService.cs", no la ruta absoluta).
// Medición al momento de escribir esto: Services 96.4/88.3, Endpoints 88.7/89.7,
// global 91.4/83.7. Los umbrales quedan unos puntos por debajo.
const BACKEND_ZONES = [
  { label: 'backend/Services', match: (file) => file.startsWith('Services/'), lines: 92, branches: 84 },
  { label: 'backend/Endpoints', match: (file) => file.startsWith('Endpoints/'), lines: 85, branches: 84 },
  { label: 'backend (global)', match: () => true, lines: 87, branches: 79 },
]

// ---------------------------------------------------------------------------
// Lectura de los informes
// ---------------------------------------------------------------------------

/** Normaliza separadores de Windows para que los `match` de arriba sean portables. */
const normalize = (value) => value.split('\\').join('/')

function readFrontendCoverage(path) {
  if (!existsSync(path)) {
    return null
  }

  const summary = JSON.parse(readFileSync(path, 'utf8'))
  const zone = (prefix) => {
    const totals = { lines: [0, 0], branches: [0, 0] }
    for (const [file, metrics] of Object.entries(summary)) {
      if (file === 'total' || (prefix && !normalize(file).includes(prefix))) {
        continue
      }
      totals.lines[0] += metrics.lines.covered
      totals.lines[1] += metrics.lines.total
      totals.branches[0] += metrics.branches.covered
      totals.branches[1] += metrics.branches.total
    }
    return totals
  }

  return [
    { label: 'frontend/src/lib', ...toPercents(zone('/src/lib/')) },
    { label: 'frontend (global)', ...toPercents(zone(null)) },
  ]
}

/**
 * Lee el Cobertura que produce `dotnet test --collect:"XPlat Code Coverage"`.
 *
 * Se parsea con expresiones regulares y no con un parser XML a propósito: sólo hacen
 * falta los atributos de cada `<class>`, y agregar una dependencia npm al repo para
 * leer un archivo generado sería peor negocio que estas dos líneas.
 */
function readBackendCoverage(resultsDir) {
  if (!existsSync(resultsDir)) {
    return null
  }

  const file = readdirSync(resultsDir)
    .map((entry) => join(resultsDir, entry, 'coverage.cobertura.xml'))
    .find(existsSync)

  if (!file) {
    return null
  }

  const xml = readFileSync(file, 'utf8')
  const classes = [...xml.matchAll(/<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)]

  return BACKEND_ZONES.map((definition) => {
    const totals = { lines: [0, 0], branches: [0, 0] }

    for (const [, filename, body] of classes) {
      if (!definition.match(normalize(filename))) {
        continue
      }

      for (const [, hits] of body.matchAll(/<line\b[^>]*\bhits="(\d+)"/g)) {
        totals.lines[1] += 1
        totals.lines[0] += Number(hits) > 0 ? 1 : 0
      }

      for (const [, covered, total] of body.matchAll(/condition-coverage="[^"]*\((\d+)\/(\d+)\)"/g)) {
        totals.branches[0] += Number(covered)
        totals.branches[1] += Number(total)
      }
    }

    return { ...definition, ...toPercents(totals) }
  })
}

function toPercents({ lines, branches }) {
  return {
    lines: percent(lines),
    branches: percent(branches),
    linesLabel: `${lines[0]}/${lines[1]}`,
    branchesLabel: `${branches[0]}/${branches[1]}`,
  }
}

const percent = ([covered, total]) => (total === 0 ? 100 : (covered / total) * 100)

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

function render(rows) {
  const lines = [
    '| Zona | Líneas | Ramas | Umbral | Estado |',
    '| --- | ---: | ---: | ---: | :---: |',
  ]

  for (const row of rows) {
    const hasGate = typeof row.lines === 'number' && row.linesThreshold !== undefined
    const passed = !hasGate || (row.lines >= row.linesThreshold && row.branches >= row.branchesThreshold)
    const gate = hasGate ? `${row.linesThreshold}% / ${row.branchesThreshold}%` : '—'

    lines.push(
      `| ${row.label} | ${row.lines.toFixed(1)}% <sub>(${row.linesLabel})</sub> | ` +
        `${row.branches.toFixed(1)}% <sub>(${row.branchesLabel})</sub> | ${gate} | ${passed ? '✅' : '❌'} |`,
    )
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------

const root = process.cwd()
const frontend = readFrontendCoverage(join(root, 'frontend', 'coverage', 'coverage-summary.json'))
const backend = readBackendCoverage(join(root, 'backend.Tests', 'TestResults'))

if (!frontend && !backend) {
  console.error('No se encontró ningún informe de cobertura. ¿Corrieron los tests antes?')
  process.exit(1)
}

const rows = [
  ...(frontend ?? []),
  ...(backend ?? []).map((zone) => ({
    ...zone,
    linesThreshold: zone.lines !== undefined ? zone.linesThreshold ?? undefined : undefined,
  })),
]

// Los umbrales sólo aplican al backend; los del frontend los hace cumplir vitest.
const gated = (backend ?? []).map((zone, index) => ({
  ...zone,
  linesThreshold: BACKEND_ZONES[index].lines,
  branchesThreshold: BACKEND_ZONES[index].branches,
}))

const table = render([...(frontend ?? []), ...gated])
console.log(table)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Cobertura\n\n${table}\n`)
}

const failures = gated.filter(
  (zone) => zone.lines < zone.linesThreshold || zone.branches < zone.branchesThreshold,
)

if (failures.length > 0 && !REPORT_ONLY) {
  console.error('\nZonas por debajo del umbral:')
  for (const zone of failures) {
    console.error(
      `  ${zone.label}: líneas ${zone.lines.toFixed(1)}% (mínimo ${zone.linesThreshold}%), ` +
        `ramas ${zone.branches.toFixed(1)}% (mínimo ${zone.branchesThreshold}%)`,
    )
  }
  process.exit(1)
}

void rows
