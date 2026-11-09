/**
 * Convierte el contenido de `pages.ts` en lo que se publica: el HTML de cada página, el
 * sitemap, el robots.txt y el llms.txt. Son funciones puras (texto adentro, texto afuera)
 * para poder probarlas sin levantar nada; `plugin.ts` es quien las conecta con el build.
 */

import { METRIC_CATALOG } from './catalog.ts'
import { escapeHtml, inline, plain } from './markup.ts'
import { PATHS, SEO_PAGES, fileForPath, pageByPath, type Block, type Cta, type SeoPage } from './pages.ts'
import {
  APP_INDEXABLE_PATHS,
  APP_PAGES_UPDATED,
  DISALLOWED_PATHS,
  LOGO_PATH,
  OG_IMAGE_PATH,
  SITE_LOCALE,
  SITE_NAME,
  THEME_COLOR,
  absoluteUrl,
} from './site.ts'

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/** `2026-11-09` → `9 de noviembre de 2026`. A mano: `Intl` depende de los datos de idioma del Node. */
export function formatDateEs(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} de ${MONTHS[month - 1]} de ${year}`
}

const DEFAULT_CTA: Cta = {
  title: 'Mirá el Wrapped de tu chat',
  body: 'Subí el archivo exportado y en segundos tenés tus estadísticas. Es gratis y el análisis se hace en tu navegador.',
  label: 'Probar Vistazo gratis',
}

const NAV_LINKS = [
  { href: PATHS.guides, label: 'Guías' },
  { href: PATHS.metrics, label: 'Métricas' },
  { href: PATHS.faq, label: 'Preguntas' },
]

const LOGO_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#1ed760"/><path d="M32 12c11 0 20 9 20 20s-9 20-20 20H16a4 4 0 0 1-4-4V32c0-11 9-20 20-20z" fill="#fff"/><circle cx="32" cy="32" r="8.5" fill="#1ed760"/><circle cx="35" cy="29" r="2.6" fill="#fff"/></svg>'

/**
 * El estilo va en cada página, en línea: son páginas de lectura que casi nadie visita dos
 * veces seguidas, y un archivo CSS aparte sería una petición más antes de poder pintar.
 * Mismos colores y bordes que la app (`tokens.css`); tipografía del sistema, que no cuesta
 * ni una descarga.
 */
const STYLES = `
:root{--wall:#f6f2e8;--wall-deep:#ece5d4;--hair:#e7dfcc;--ink:#121212;--soft:#2f2c26;--muted:#52525b;--green:#1ed760;--green-deep:#0a662a;--link:#0f7a37;--bubble:#d9fdd3;--card:#fff;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--wall);color:var(--ink);font:400 1.0625rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link);text-underline-offset:2px}
a:hover{color:var(--green-deep)}
:focus-visible{outline:2px solid var(--green-deep);outline-offset:3px;border-radius:4px}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:#fff;padding:8px 12px;border-radius:8px;z-index:10}
.skip:focus{left:8px}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
.bar{display:flex;align-items:center;gap:14px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:1.15rem;letter-spacing:-.01em;color:var(--ink);text-decoration:none;margin-right:auto}
.brand svg{width:30px;height:30px;display:block}
.top a{color:var(--soft);text-decoration:none;font-weight:500;font-size:.95rem;margin-left:14px}
.top a:hover{color:var(--green-deep);text-decoration:underline}
.btn{display:inline-block;background:var(--green);color:var(--ink);font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px;box-shadow:0 1px 0 rgba(18,18,18,.12),0 10px 24px -8px rgba(18,140,60,.45)}
.btn:hover{color:var(--ink);filter:brightness(.96)}
.btn.sm{padding:8px 16px;font-size:.92rem}
.crumbs{font-size:.85rem;color:var(--muted);margin:18px 0 6px}
.crumbs a{color:var(--muted)}
h1{font-size:clamp(1.85rem,5.4vw,2.6rem);line-height:1.14;letter-spacing:-.025em;margin:.35em 0 .45em;font-weight:800}
.lead{font-size:1.18rem;color:var(--soft);margin:0 0 .6em}
.meta{font-size:.85rem;color:var(--muted);margin:0 0 1.5em}
h2{font-size:1.5rem;line-height:1.25;letter-spacing:-.015em;margin:2em 0 .6em;font-weight:800}
h3{font-size:1.1rem;margin:1.5em 0 .3em;font-weight:700}
p{margin:.7em 0}
ul,ol{padding-left:1.35em;margin:.7em 0}
li{margin:.4em 0}
code{background:var(--wall-deep);padding:.1em .38em;border-radius:6px;font-size:.92em}
.cta{margin:2.4em 0 0;padding:22px 24px;background:var(--bubble);border-radius:18px 4px 18px 18px;border:1px solid rgba(30,215,96,.45)}
.cta h2{margin:0 0 .3em;font-size:1.3rem}
.cta p{margin:.3em 0 1em}
.cards{display:grid;gap:12px;padding:0;list-style:none}
.cards li{margin:0}
.card{display:block;background:var(--card);border:1px solid var(--hair);border-radius:18px;padding:16px 18px;text-decoration:none;color:var(--ink);box-shadow:0 1px 0 rgba(18,18,18,.05)}
.card:hover{border-color:var(--green)}
.card strong{display:block;font-size:1.05rem;margin-bottom:2px}
.card span{color:var(--muted);font-size:.95rem}
footer{border-top:1px solid var(--hair);margin-top:36px;padding:24px 0 44px;color:var(--muted);font-size:.88rem}
footer nav a{color:var(--soft);margin-right:16px;display:inline-block}
footer p{margin:.9em 0 0;max-width:62ch}
@media (max-width:560px){.top{order:3;width:100%}.top a{margin:0 14px 0 0}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`.trim()

// ---------------------------------------------------------------------------
// Datos estructurados

function jsonLd(data: unknown): string {
  // `<` fuera: un `</script>` dentro de un texto cerraría el bloque antes de tiempo.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

function breadcrumbItems(page: SeoPage): { name: string; path: string }[] {
  const items = [{ name: 'Inicio', path: '/' }]
  if (page.kind === 'guide') {
    items.push({ name: 'Guías', path: PATHS.guides })
  }
  items.push({ name: page.crumb, path: page.path })
  return items
}

function structuredData(page: SeoPage, siteUrl: string): unknown {
  const url = absoluteUrl(siteUrl, page.path)
  const organizationId = absoluteUrl(siteUrl, '/#organization')
  const organization = {
    '@type': 'Organization',
    '@id': organizationId,
    name: SITE_NAME,
    url: absoluteUrl(siteUrl, '/'),
    logo: { '@type': 'ImageObject', url: absoluteUrl(siteUrl, LOGO_PATH), width: 512, height: 512 },
  }

  const graph: unknown[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbItems(page).map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: absoluteUrl(siteUrl, item.path),
      })),
    },
  ]

  if (page.kind === 'guide') {
    graph.push({
      '@type': 'Article',
      headline: page.h1,
      description: page.description,
      inLanguage: 'es',
      datePublished: page.published,
      dateModified: page.updated,
      mainEntityOfPage: url,
      image: [absoluteUrl(siteUrl, OG_IMAGE_PATH)],
      author: organization,
      publisher: organization,
    })
  }

  if (page.kind === 'hub') {
    graph.push({
      '@type': 'CollectionPage',
      name: page.h1,
      description: page.description,
      url,
      inLanguage: 'es',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: guidePages().map((guide, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: guide.h1,
          url: absoluteUrl(siteUrl, guide.path),
        })),
      },
    })
  }

  if (page.kind === 'catalog') {
    graph.push({
      '@type': 'CollectionPage',
      name: page.h1,
      description: page.description,
      url,
      inLanguage: 'es',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: METRIC_CATALOG.map((metric, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: metric.name,
          url: `${url}#${metric.id}`,
        })),
      },
    })
  }

  if (page.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: page.faq.map((entry) => ({
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer', text: plain(entry.answer) },
      })),
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}

// ---------------------------------------------------------------------------
// HTML

function guidePages(): SeoPage[] {
  return SEO_PAGES.filter((page) => page.kind === 'guide')
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'p':
      return `<p>${inline(block.text)}</p>`
    case 'ul':
      return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`
    case 'ol':
      return `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`
    case 'h3':
      return `<h3 id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h3>`
  }
}

function renderCards(pages: readonly SeoPage[]): string {
  return `<ul class="cards">${pages
    .map(
      (page) =>
        `<li><a class="card" href="${escapeHtml(page.path)}"><strong>${escapeHtml(page.h1)}</strong><span>${escapeHtml(page.description)}</span></a></li>`,
    )
    .join('')}</ul>`
}

function renderBreadcrumbs(page: SeoPage): string {
  const items = breadcrumbItems(page)
  const last = items.length - 1
  const parts = items.map((item, index) =>
    index === last
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a>`,
  )
  return `<nav class="crumbs" aria-label="Migas de pan">${parts.join(' › ')}</nav>`
}

function renderFaq(page: SeoPage): string {
  if (!page.faq?.length) {
    return ''
  }

  const isFaqPage = page.kind === 'faq'
  const level = isFaqPage ? 'h2' : 'h3'
  const items = page.faq
    .map((entry) => `<${level}>${escapeHtml(entry.question)}</${level}><p>${inline(entry.answer)}</p>`)
    .join('')

  return isFaqPage ? `<section>${items}</section>` : `<section id="preguntas"><h2>Preguntas frecuentes</h2>${items}</section>`
}

function renderCta(cta: Cta): string {
  return `<aside class="cta"><h2>${escapeHtml(cta.title)}</h2><p>${escapeHtml(cta.body)}</p><a class="btn" href="/">${escapeHtml(cta.label)}</a></aside>`
}

function renderRelated(page: SeoPage): string {
  const related = (page.related ?? []).map((path) => pageByPath(path)).filter((entry): entry is SeoPage => Boolean(entry))
  if (related.length === 0) {
    return ''
  }
  return `<section><h2>Seguí leyendo</h2>${renderCards(related)}</section>`
}

function renderHead(page: SeoPage, siteUrl: string): string {
  const url = absoluteUrl(siteUrl, page.path)
  const image = absoluteUrl(siteUrl, OG_IMAGE_PATH)
  const title = escapeHtml(page.title)
  const description = escapeHtml(page.description)
  const ogType = page.kind === 'guide' ? 'article' : 'website'

  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<meta name="theme-color" content="${THEME_COLOR}">`,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">',
    '<link rel="apple-touch-icon" href="/icon-192.png">',
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="${SITE_LOCALE}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    '<meta property="og:image:type" content="image/jpeg">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    jsonLd(structuredData(page, siteUrl)),
    `<style>${STYLES}</style>`,
  ].join('\n')
}

function renderHeader(): string {
  const links = NAV_LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')
  return `<header><div class="wrap bar"><a class="brand" href="/">${LOGO_SVG}<span>${SITE_NAME}</span></a><nav class="top" aria-label="Principal">${links}</nav><a class="btn sm" href="/">Probar gratis</a></div></header>`
}

function renderFooter(): string {
  const links = [
    { href: '/', label: 'Inicio' },
    ...NAV_LINKS.map((link) => ({ href: link.href, label: link.label === 'Preguntas' ? 'Preguntas frecuentes' : link.label })),
    { href: '/terminos', label: 'Términos y condiciones' },
  ]
    .map((link) => `<a href="${link.href}">${link.label}</a>`)
    .join('')

  return `<footer><div class="wrap"><nav aria-label="Pie">${links}</nav><p>WhatsApp es una marca de Meta. ${SITE_NAME} es un proyecto independiente y no está afiliado ni respaldado por WhatsApp ni por Meta.</p></div></footer>`
}

export function renderPage(page: SeoPage, siteUrl: string): string {
  const sections = page.sections
    .map((section) => `<section><h2>${escapeHtml(section.heading)}</h2>${section.blocks.map(renderBlock).join('')}</section>`)
    .join('')
  const hubList = page.kind === 'hub' ? `<section><h2>Todas las guías</h2>${renderCards(guidePages())}</section>` : ''

  return `<!doctype html>
<html lang="es">
<head>
${renderHead(page, siteUrl)}
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>
${renderHeader()}
<main id="contenido" class="wrap">
${renderBreadcrumbs(page)}
<article>
<h1>${escapeHtml(page.h1)}</h1>
<p class="lead">${inline(page.lead)}</p>
<p class="meta">Actualizado el <time datetime="${page.updated}">${formatDateEs(page.updated)}</time></p>
${sections}${hubList}${renderFaq(page)}${renderCta(page.cta ?? DEFAULT_CTA)}${renderRelated(page)}
</article>
</main>
${renderFooter()}
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Sitemap, robots y llms.txt

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Las URLs del sitemap con su fecha: la portada y las páginas estáticas. */
export function sitemapEntries(): { path: string; lastmod: string }[] {
  return [
    ...APP_INDEXABLE_PATHS.map((path) => ({ path, lastmod: APP_PAGES_UPDATED })),
    ...SEO_PAGES.map((page) => ({ path: page.path, lastmod: page.updated })),
  ]
}

export function renderSitemap(siteUrl: string): string {
  const urls = sitemapEntries()
    .map((entry) => `  <url><loc>${xmlEscape(absoluteUrl(siteUrl, entry.path))}</loc><lastmod>${entry.lastmod}</lastmod></url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function renderRobots(siteUrl: string): string {
  const lines = ['User-agent: *', 'Allow: /', ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`)]

  // El sitemap tiene que ir con URL completa: sin saber el dominio (un build local) se omite
  // en vez de publicar una ruta relativa que ningún buscador entiende.
  if (siteUrl) {
    lines.push('', `Sitemap: ${absoluteUrl(siteUrl, '/sitemap.xml')}`)
  }

  return `${lines.join('\n')}\n`
}

export function renderLlmsTxt(siteUrl: string): string {
  const pages = SEO_PAGES.map((page) => `- [${page.h1}](${absoluteUrl(siteUrl, page.path)}): ${plain(page.description)}`).join('\n')

  return `# ${SITE_NAME}

> ${SITE_NAME} es una app web, gratis para empezar, que convierte el chat de WhatsApp que exportás en un "Wrapped" con ${METRIC_CATALOG.length} métricas: quién habla más, a qué hora, quién tarda en responder y más. El análisis se hace en el navegador.

## Qué hace
- Acepta el .txt o el .zip que exporta WhatsApp, en Android y en iPhone.
- Funciona con chats de a dos y con grupos.
- Tiene métricas gratis y métricas Pro (suscripción mensual con prueba gratis).
- La interfaz está en español y en inglés.

## Páginas
- [Portada](${absoluteUrl(siteUrl, '/')}): subir un chat y ver su Wrapped.
${pages}

## Aclaración
${SITE_NAME} es un proyecto independiente, sin relación con WhatsApp ni con Meta.
`
}

// ---------------------------------------------------------------------------
// Todo lo que el build tiene que escribir

export interface EmittedFile {
  /** Ruta dentro de `dist/`. */
  fileName: string
  /** Rutas públicas que lo sirven (para el servidor de desarrollo y el de preview). */
  urls: string[]
  contentType: string
  source: string
}

export function buildSeoFiles(siteUrl: string): EmittedFile[] {
  const html = 'text/html; charset=utf-8'

  return [
    ...SEO_PAGES.map((page) => ({
      fileName: fileForPath(page.path),
      urls: [page.path, `/${fileForPath(page.path)}`],
      contentType: html,
      source: renderPage(page, siteUrl),
    })),
    { fileName: 'sitemap.xml', urls: ['/sitemap.xml'], contentType: 'application/xml; charset=utf-8', source: renderSitemap(siteUrl) },
    { fileName: 'robots.txt', urls: ['/robots.txt'], contentType: 'text/plain; charset=utf-8', source: renderRobots(siteUrl) },
    { fileName: 'llms.txt', urls: ['/llms.txt'], contentType: 'text/plain; charset=utf-8', source: renderLlmsTxt(siteUrl) },
  ]
}
