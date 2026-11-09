import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FREE_METRICS, METRIC_CATALOG, PRO_METRICS } from '../catalog.ts'
import { escapeHtml, inline, internalLinks, plain } from '../markup.ts'
import { PATHS, SEO_PAGES, fileForPath, pageByPath, type SeoPage } from '../pages.ts'
import { applySiteUrl, normalizePath, seoPlugin, verificationTags } from '../plugin.ts'
import { buildSeoFiles, formatDateEs, renderLlmsTxt, renderPage, renderRobots, renderSitemap, sitemapEntries } from '../render.ts'
import { APP_INDEXABLE_PATHS, DISALLOWED_PATHS, NOINDEX_SOURCES, absoluteUrl, resolveSiteUrl } from '../site.ts'

const SITE = 'https://vistazo.example'

const frontendRoot = fileURLToPath(new URL('../../', import.meta.url))
const read = (relative: string) => readFileSync(`${frontendRoot}${relative}`, 'utf8')

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as Record<string, unknown>,
  )
}

function graphTypes(html: string): string[] {
  return jsonLdBlocks(html).flatMap((block) => (block['@graph'] as { '@type': string }[]).map((node) => node['@type']))
}

/** Todos los textos de una página donde puede haber un link con el mini-markup. */
function textsOf(page: SeoPage): string[] {
  return [
    page.lead,
    ...page.sections.flatMap((section) =>
      section.blocks.flatMap((block) => {
        if (block.kind === 'p') return [block.text]
        if (block.kind === 'h3') return []
        return [...block.items]
      }),
    ),
    ...(page.faq ?? []).map((entry) => entry.answer),
  ]
}

describe('resolveSiteUrl', () => {
  it('prefiere VITE_SITE_URL y le saca la barra final', () => {
    expect(resolveSiteUrl('https://vistazo.app/', 'otro.vercel.app')).toBe('https://vistazo.app')
  })

  it('usa el dominio de producción de Vercel, que llega sin protocolo', () => {
    expect(resolveSiteUrl(undefined, 'whatsapp-wrapper-metrics.vercel.app')).toBe('https://whatsapp-wrapper-metrics.vercel.app')
    expect(resolveSiteUrl('', 'https://vistazo.app/')).toBe('https://vistazo.app')
  })

  it('queda vacío en local, donde las rutas relativas son lo correcto', () => {
    expect(resolveSiteUrl(undefined, undefined)).toBe('')
    expect(resolveSiteUrl('  ', '  ')).toBe('')
  })
})

describe('markup', () => {
  it('escapa el HTML del texto', () => {
    expect(inline('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(escapeHtml(`a & b 'c'`)).toBe('a &amp; b &#39;c&#39;')
  })

  it('arma links internos, negrita y código', () => {
    expect(inline('Mirá [la guía](/guias/x), **ojo** y `.zip`.')).toBe(
      'Mirá <a href="/guias/x">la guía</a>, <strong>ojo</strong> y <code>.zip</code>.',
    )
  })

  it('no arma links hacia afuera del sitio', () => {
    expect(inline('[malo](https://evil.example) y [peor](javascript:alert(1))')).not.toContain('<a ')
  })

  it('saca el markup para los datos estructurados', () => {
    expect(plain('Mirá [la guía](/guias/x), **ojo** y `.zip`.')).toBe('Mirá la guía, ojo y .zip.')
  })

  it('lista las rutas internas sin ancla', () => {
    expect(internalLinks('[a](/guias/x#y) y [b](/) y [c](https://x.example)')).toEqual(['/guias/x', '/'])
  })
})

describe('páginas de contenido', () => {
  it('no repiten ruta, título, descripción ni h1', () => {
    for (const field of ['path', 'title', 'description', 'h1'] as const) {
      const values = SEO_PAGES.map((page) => page[field])
      expect(new Set(values).size, field).toBe(values.length)
    }
  })

  it.each(SEO_PAGES.map((page) => [page.path, page] as const))('%s: título y descripción caben en el resultado de Google', (_path, page) => {
    expect(page.title.length).toBeGreaterThanOrEqual(25)
    expect(page.title.length).toBeLessThanOrEqual(65)
    expect(page.description.length).toBeGreaterThanOrEqual(100)
    expect(page.description.length).toBeLessThanOrEqual(165)
    expect(page.h1.length).toBeLessThanOrEqual(110)
  })

  it.each(SEO_PAGES.map((page) => [page.path, page] as const))('%s: tiene su propio HTML completo', (_path, page) => {
    const html = renderPage(page, SITE)

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="es">')
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html).toContain(`<title>${escapeHtml(page.title)}</title>`)
    expect(html).toContain(`<link rel="canonical" href="${SITE}${page.path}">`)
    expect(html).toContain(`<meta property="og:url" content="${SITE}${page.path}">`)
    expect(html).toContain(`<meta property="og:image" content="${SITE}/og-image.jpg">`)
    expect(html).toContain('index, follow')
    expect(html).not.toContain('__SITE_URL__')
    expect(html).not.toContain('noindex')
  })

  it.each(SEO_PAGES.map((page) => [page.path, page] as const))('%s: los datos estructurados son JSON válido', (_path, page) => {
    const types = graphTypes(renderPage(page, SITE))

    expect(types).toContain('BreadcrumbList')
    expect(types.includes('Article')).toBe(page.kind === 'guide')
    expect(types.includes('FAQPage')).toBe(Boolean(page.faq?.length))
    expect(types.includes('CollectionPage')).toBe(page.kind === 'hub' || page.kind === 'catalog')
  })

  it('cada link interno apunta a algo que existe', () => {
    const known = new Set([...SEO_PAGES.map((page) => page.path), '/', '/terminos', '/ayuda'])

    for (const page of SEO_PAGES) {
      for (const text of textsOf(page)) {
        for (const link of internalLinks(text)) {
          expect(known.has(link), `${page.path} enlaza a ${link}`).toBe(true)
        }
      }
      for (const related of page.related ?? []) {
        expect(pageByPath(related), `${page.path} relaciona ${related}`).toBeDefined()
      }
    }
  })

  it('las fechas son válidas y no se actualiza antes de publicar', () => {
    for (const page of SEO_PAGES) {
      expect(page.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(page.updated >= page.published, page.path).toBe(true)
    }
    expect(formatDateEs('2026-11-09')).toBe('9 de noviembre de 2026')
  })

  it('el hub lista todas las guías', () => {
    const hub = renderPage(pageByPath(PATHS.guides)!, SITE)

    for (const guide of SEO_PAGES.filter((page) => page.kind === 'guide')) {
      expect(hub).toContain(`href="${guide.path}"`)
    }
  })

  it('las preguntas frecuentes van en los datos estructurados sin el markup', () => {
    const faq = pageByPath(PATHS.faq)!
    const block = jsonLdBlocks(renderPage(faq, SITE))[0]['@graph'] as { '@type': string; mainEntity?: { acceptedAnswer: { text: string } }[] }[]
    const answers = block.find((node) => node['@type'] === 'FAQPage')!.mainEntity!.map((entry) => entry.acceptedAnswer.text)

    expect(answers).toHaveLength(faq.faq!.length)
    expect(answers.join(' ')).not.toMatch(/\]\(|\*\*|`/)
  })

  it('el pie aclara que no es WhatsApp', () => {
    expect(renderPage(SEO_PAGES[0], SITE)).toContain('no está afiliado')
  })

  it('un texto con HTML no llega como etiqueta', () => {
    const page: SeoPage = { ...SEO_PAGES[0], h1: '<b>x</b>', lead: '<img src=x onerror=alert(1)>' }
    const html = renderPage(page, SITE)

    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<img src=x')
  })

  it('cada página tiene su archivo', () => {
    expect(fileForPath('/guias')).toBe('guias/index.html')
    expect(fileForPath('/guias/como-exportar-chat-whatsapp')).toBe('guias/como-exportar-chat-whatsapp.html')
    expect(fileForPath('/metricas')).toBe('metricas.html')
  })
})

describe('catálogo de métricas', () => {
  const registrySource = read('src/lib/metrics.ts')

  /** `PROFILE_METRIC_ID` es una constante de otro archivo: se resuelve leyendo `src/lib`. */
  function profileMetricId(): string {
    for (const file of readdirSync(`${frontendRoot}src/lib`).filter((name) => name.endsWith('.ts'))) {
      const match = /PROFILE_METRIC_ID\s*=\s*'([\w-]+)'/.exec(read(`src/lib/${file}`))
      if (match) return match[1]
    }
    throw new Error('No se encontró PROFILE_METRIC_ID en src/lib')
  }

  const registry = [...registrySource.matchAll(/\{\s*id:\s*(?:'([\w-]+)'|(PROFILE_METRIC_ID)),\s*tier:\s*'(free|vip)'/g)].map((match) => ({
    id: match[1] ?? profileMetricId(),
    tier: match[3] === 'vip' ? 'pro' : 'free',
  }))

  it('es la misma lista que usa la app, con el mismo reparto entre gratis y Pro', () => {
    const sorted = (items: { id: string; tier: string }[]) => items.map((item) => `${item.tier}:${item.id}`).sort()

    expect(registry.length).toBeGreaterThan(0)
    expect(sorted([...METRIC_CATALOG])).toEqual(sorted(registry))
  })

  it('los números que se dicen en el texto son los de la lista', () => {
    const catalog = pageByPath(PATHS.metrics)!
    const total = METRIC_CATALOG.length

    expect(catalog.title).toContain(String(total))
    expect(catalog.h1).toContain(String(total))
    expect(catalog.description).toContain(`${FREE_METRICS.length} gratis y ${PRO_METRICS.length} Pro`)
    expect(catalog.lead).toContain(`${total} métricas: ${FREE_METRICS.length} son gratis y ${PRO_METRICS.length} son Pro`)
    expect(read('index.html')).toContain(`${total} métricas`)

    for (const page of SEO_PAGES) {
      for (const text of textsOf(page)) {
        if (/\b\d+ métricas/.test(text)) {
          expect(text, page.path).toContain(`${total} métricas`)
        }
      }
    }
  })

  it('cada métrica tiene su ancla en la página', () => {
    const html = renderPage(pageByPath(PATHS.metrics)!, SITE)

    for (const metric of METRIC_CATALOG) {
      expect(html).toContain(`<h3 id="${metric.id}">`)
    }
  })
})

describe('sitemap y robots', () => {
  it('el sitemap lista la portada y todas las páginas, con URL absoluta', () => {
    const xml = renderSitemap(SITE)

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain(`<loc>${SITE}/</loc>`)
    for (const page of SEO_PAGES) {
      expect(xml).toContain(`<loc>${SITE}${page.path}</loc><lastmod>${page.updated}</lastmod>`)
    }
    expect(sitemapEntries()).toHaveLength(APP_INDEXABLE_PATHS.length + SEO_PAGES.length)
  })

  it('el sitemap no lista rutas privadas ni recorridos compartidos', () => {
    const xml = renderSitemap(SITE)

    for (const path of [...DISALLOWED_PATHS, '/s/', '/terminos', '/ayuda']) {
      expect(xml, path).not.toContain(`${SITE}${path}`)
    }
  })

  it('robots.txt bloquea lo privado y apunta al sitemap', () => {
    const robots = renderRobots(SITE)

    expect(robots).toContain('User-agent: *\nAllow: /')
    for (const path of DISALLOWED_PATHS) {
      expect(robots).toContain(`Disallow: ${path}`)
    }
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('robots.txt no deja bloqueados los recorridos compartidos: tienen que poder abrirlos las vistas previas', () => {
    expect(renderRobots(SITE)).not.toContain('/s/')
  })

  it('sin dominio conocido, robots.txt omite el sitemap en vez de publicar una ruta relativa', () => {
    expect(renderRobots('')).not.toContain('Sitemap:')
  })

  it('llms.txt resume el sitio y enlaza las páginas', () => {
    const llms = renderLlmsTxt(SITE)

    expect(llms.startsWith('# Vistazo')).toBe(true)
    for (const page of SEO_PAGES) {
      expect(llms).toContain(`(${SITE}${page.path})`)
    }
  })

  it('el build escribe cada página, el sitemap, el robots y el llms', () => {
    const names = buildSeoFiles(SITE).map((file) => file.fileName)

    expect(names).toEqual(expect.arrayContaining([...SEO_PAGES.map((page) => fileForPath(page.path)), 'sitemap.xml', 'robots.txt', 'llms.txt']))
  })

  it('el servidor responde la ruta con y sin barra final', () => {
    expect(normalizePath('/guias/')).toBe('/guias')
    expect(normalizePath('/')).toBe('/')
    expect(buildSeoFiles(SITE).find((file) => file.fileName === 'guias/index.html')?.urls).toContain('/guias')
  })
})

describe('vercel.json', () => {
  const config = JSON.parse(read('vercel.json')) as {
    rewrites: { source: string; destination: string }[]
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }

  /** Lo mínimo de path-to-regexp que usa el archivo: `:param` y `(.*)`. */
  function matches(source: string, path: string): Record<string, string> | null {
    const names: string[] = []
    const pattern = source.replace(/:(\w+)\*?/g, (_all, name: string) => {
      names.push(name)
      return '([^/]+)'
    })
    const match = new RegExp(`^${pattern}$`).exec(path)
    return match ? Object.fromEntries(names.map((name, index) => [name, match[index + 1]])) : null
  }

  it('cada página se reescribe a su archivo antes del fallback de la app', () => {
    const fallback = config.rewrites.findIndex((rewrite) => rewrite.destination === '/index.html')
    expect(fallback).toBe(config.rewrites.length - 1)

    for (const page of SEO_PAGES) {
      const index = config.rewrites.findIndex((rewrite) => matches(rewrite.source, page.path))
      expect(index, `${page.path} no tiene regla`).toBeGreaterThanOrEqual(0)
      expect(index, `${page.path} cae en el fallback`).toBeLessThan(fallback)

      const rule = config.rewrites[index]
      const params = matches(rule.source, page.path)!
      const destination = rule.destination.replace(/:(\w+)/g, (_all, name: string) => params[name])
      expect(destination).toBe(`/${fileForPath(page.path)}`)
    }
  })

  it('las rutas sin valor para un buscador salen con noindex', () => {
    for (const source of NOINDEX_SOURCES) {
      const rule = config.headers.find((entry) => entry.source === source)
      expect(rule, `${source} sin regla`).toBeDefined()

      const robots = rule!.headers.find((header) => header.key === 'X-Robots-Tag')
      expect(robots?.value).toContain('noindex')
    }
  })

  it('las páginas indexables no llevan noindex', () => {
    for (const page of SEO_PAGES) {
      for (const rule of config.headers) {
        if (rule.headers.some((header) => header.key === 'X-Robots-Tag')) {
          expect(matches(rule.source, page.path), `${page.path} cae en ${rule.source}`).toBeNull()
        }
      }
    }
  })
})

describe('index.html', () => {
  const html = read('index.html')

  it('tiene título y descripción del tamaño de un resultado de Google', () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)![1]
    const description = /<meta\s+name="description"\s+content="([^"]+)"/.exec(html)![1]

    expect(title.length).toBeLessThanOrEqual(65)
    expect(title).toContain('Wrapped de WhatsApp')
    expect(description.length).toBeGreaterThanOrEqual(100)
    expect(description.length).toBeLessThanOrEqual(165)
  })

  it('declara su canónica y es indexable', () => {
    expect(html).toContain('<link rel="canonical" href="__SITE_URL__/" />')
    expect(html).toContain('content="index, follow')
  })

  it('no fija og:url: este HTML es el de todos los links compartidos', () => {
    expect(html).not.toContain('property="og:url"')
  })

  it('los datos estructurados son JSON válido y describen el sitio y la app', () => {
    const types = graphTypes(applySiteUrl(html, SITE))

    expect(types).toEqual(['Organization', 'WebSite', 'WebApplication'])
  })

  it('no inventa reseñas ni puntaje', () => {
    expect(JSON.stringify(jsonLdBlocks(applySiteUrl(html, SITE)))).not.toMatch(/aggregateRating|"review"/)
  })

  it('el contenido para quien no ejecuta JavaScript enlaza a páginas que existen', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)![1]
    const links = [...noscript.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1])
    const known = new Set(SEO_PAGES.map((page) => page.path))

    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(known.has(link), link).toBe(true)
    }
  })
})

describe('verificación de Search Console', () => {
  const files = readdirSync(`${frontendRoot}public`).filter((name) => /^google[0-9a-f]+\.html$/.test(name))

  // Google pide que el archivo quede publicado "aunque la verificación ya haya salido bien":
  // lo vuelve a chequear de tanto en tanto, y si no está, se pierde la propiedad sin aviso.
  it('el archivo de verificación sigue en public/', () => {
    expect(files.length, 'falta el archivo googleXXXX.html de Search Console').toBeGreaterThan(0)
  })

  it('cada archivo dice su propio nombre, tal como lo genera Google', () => {
    for (const name of files) {
      expect(read(`public/${name}`).trim(), name).toBe(`google-site-verification: ${name}`)
    }
  })
})

describe('plugin', () => {
  it('reemplaza __SITE_URL__ en todo el HTML', () => {
    expect(applySiteUrl('a __SITE_URL__/x b __SITE_URL__/y', SITE)).toBe(`a ${SITE}/x b ${SITE}/y`)
    expect(applySiteUrl('__SITE_URL__/og-image.jpg', '')).toBe('/og-image.jpg')
  })

  it('con dominio deja la canónica absoluta; sin dominio la saca, porque Vite leería "/" como un archivo', () => {
    const html = read('index.html')

    expect(applySiteUrl(html, SITE)).toContain(`<link rel="canonical" href="${SITE}/" />`)
    expect(applySiteUrl(html, '')).not.toContain('rel="canonical"')
    expect(applySiteUrl(html, '')).not.toContain('__SITE_URL__')
  })

  it('suma las etiquetas de verificación sólo si hay token', () => {
    expect(verificationTags({})).toEqual([])
    expect(verificationTags({ googleVerification: ' abc ', bingVerification: 'def' })).toEqual([
      { tag: 'meta', attrs: { name: 'google-site-verification', content: 'abc' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'msvalidate.01', content: 'def' }, injectTo: 'head' },
    ])
  })

  it('se arma sin errores y expone sus ganchos', () => {
    const plugin = seoPlugin({ siteUrl: SITE })

    expect(plugin.name).toBe('vistazo-seo')
    expect(typeof plugin.generateBundle).toBe('function')
    expect(typeof plugin.configureServer).toBe('function')
    expect(typeof plugin.configurePreviewServer).toBe('function')
    expect(absoluteUrl(SITE, '/guias')).toBe(`${SITE}/guias`)
  })
})
