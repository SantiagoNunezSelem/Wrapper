# SEO

Cómo está armado el SEO de Vistazo, qué falta hacer a mano y qué mirar después. Lo que no
depende de nadie (técnico y contenido) está en el código; lo que depende de una cuenta o de
una decisión (dominio, Search Console, difusión) está en las secciones 2 y 5.

## 1. Qué hay hecho

**La portada** (`frontend/index.html`) es una SPA: Google ejecuta el JavaScript y la indexa,
pero otros rastreadores (los de IA, los de vistas previas) leen sólo el HTML. Por eso tiene
título y descripción con las palabras que se buscan, canónica, Open Graph y Twitter, datos
estructurados (`Organization`, `WebSite`, `WebApplication`) y un `<noscript>` con texto y links.

**Las páginas de contenido** son HTML puro, sin JavaScript, generado en cada build desde
`frontend/seo/`: es donde se compite por las búsquedas, porque cada una responde una pregunta
concreta. Cada una lleva su título, descripción, canónica, Open Graph y datos estructurados
(`Article`, `BreadcrumbList`, `FAQPage`, `CollectionPage`).

| Página | Búsqueda que apunta a contestar |
| --- | --- |
| `/guias/como-exportar-chat-whatsapp` | cómo exportar un chat de WhatsApp (Android, iPhone, sin multimedia) |
| `/guias/que-es-el-wrapped-de-whatsapp` | wrapped de WhatsApp, resumen de un chat tipo Spotify |
| `/guias/cuantos-mensajes-hay-en-un-chat-de-whatsapp` | cuántos mensajes hay en un chat, quién habla más en un grupo |
| `/guias/quien-tarda-mas-en-responder-en-whatsapp` | quién tarda en responder, quién te deja en visto |
| `/guias/es-seguro-analizar-chat-whatsapp` | es seguro analizar un chat, privacidad |
| `/guias/detector-de-red-flags-en-chats-de-whatsapp` | red flags en un chat de WhatsApp |
| `/metricas` | estadísticas de un chat de WhatsApp (las 25, una por una) |
| `/preguntas-frecuentes` | dudas sobre Vistazo (gratis, privacidad, Pro) |

No hay datos de volumen de búsqueda: Search Console va a mostrar qué consultas llegan de
verdad, y con eso se ajusta (sección 4).

**Archivos que genera el build** (`dist/`): `sitemap.xml`, `robots.txt` y `llms.txt` (un
resumen para buscadores con IA), todos con el dominio real.

**`frontend/vercel.json`**: reescribe las URLs de las páginas a sus archivos, manda
`X-Robots-Tag: noindex` en los recorridos compartidos (`/s/…`), `/admin`, `/suscripcion` y
`/ayuda`, y cachea `/assets` por un año.

**Links desde la app**: el pie de desktop y el final del Inicio en mobile enlazan a las
guías con `<a href>` de verdad (sólo en español), que es por donde Google las descubre desde
la portada.

**Tests** (`frontend/seo/__tests__`): largo de títulos y descripciones, un solo `h1` por página,
datos estructurados válidos, que todo link interno exista, el sitemap, el robots, que
`vercel.json` cubra cada página y que `/metricas` sea la misma lista que usa la app (13 gratis
y 12 Pro). Si se agrega una métrica y no se actualiza el catálogo, el test falla.

## 2. Lo que hay que hacer a mano, una sola vez

1. **Dominio propio, antes de que Google indexe.** Hoy el sitio vive en
   `whatsapp-wrapper-metrics.vercel.app`; cambiar de dominio después pierde lo ganado.
   - Comprarlo y conectarlo en Vercel (*Settings → Domains*). Después, en el dominio
     `.vercel.app`, elegir *Redirect to* el propio, para que no queden dos copias del sitio.
   - Evitar "whatsapp" en el nombre: es una marca de Meta y hace más fácil un reclamo.
   - El código no se toca: el canónico, el sitemap y las vistas previas toman el dominio de
     producción que Vercel expone (`VERCEL_PROJECT_PRODUCTION_URL`). Verificar que esté activo
     *Automatically expose System Environment Variables* (*Settings → Environment Variables*);
     si no, definir `VITE_SITE_URL`. Si Vercel no tiene el dominio, el build avisa con una
     advertencia.
   - Sí hay que actualizar lo que apunta al dominio viejo: `Cors:AllowedOrigins` del backend,
     los orígenes autorizados del cliente OAuth de Google y `MercadoPago:BackUrl`.
2. **Google Search Console** ([search.google.com/search-console](https://search.google.com/search-console)).
   Crear la propiedad con el dominio final, elegir verificar con la etiqueta HTML, copiar el
   `content` de `google-site-verification` a la variable `VITE_GOOGLE_SITE_VERIFICATION` en
   Vercel, redesplegar y apretar *Verificar*. Después: *Sitemaps* → enviar `sitemap.xml`, y en
   *Inspección de URLs* pedir la indexación de la portada y de cada página nueva.
3. **Bing Webmaster Tools**: *Importar desde Google Search Console*. Bing alimenta a
   DuckDuckGo, Ecosia y Copilot. Si pide verificación con etiqueta, va en `VITE_BING_SITE_VERIFICATION`.
4. **Medición**: con Search Console alcanza para saber qué se busca y qué clics llegan. Vercel
   Web Analytics (gratis, sin cookies) suma visitas reales; se activa desde el panel y requiere
   sumar su script.

Indexar lleva de días a semanas. Spotify Wrapped sale entre fines de noviembre y principios
de diciembre y dispara las búsquedas de "wrapped": conviene publicar ya.

## 3. Cosas a tener en cuenta

- **El nombre choca con una revista.** *Vistazo* es una revista ecuatoriana de 1957
  ([vistazo.com](https://www.vistazo.com)) y además una palabra común: la búsqueda "vistazo"
  sola la va a ganar la revista. Por eso los títulos dicen "Wrapped de WhatsApp" y el sitio se
  declara también como "Vistazo Wrapped". Si la marca importa, vale pensar un dominio o un
  apellido distintivo; las guías compiten por búsquedas sin marca y no dependen de esto.
- **Sólo español.** La app tiene versión en inglés, pero las páginas de contenido no, y el Pro
  se cobra en pesos por Mercado Pago. Si Search Console muestra tráfico en inglés, se suman
  `/en/…` con `hreflang`.
- **Los recorridos compartidos no se indexan**, a propósito: tienen datos de un chat. No se
  bloquean en `robots.txt` porque WhatsApp, Facebook y X tienen que poder abrirlos para dibujar
  la vista previa.
- **Sin precios en el texto.** Cambian en el backend; las páginas dicen "suscripción mensual
  con prueba gratis" y la app muestra el precio vigente.
- **Sin reseñas ni puntaje** en los datos estructurados: no hay ninguno real, y declararlos
  falsos es motivo de sanción.

## 4. Qué mirar después (primeros tres meses)

- *Search Console → Rendimiento*, cada semana: consultas con muchas impresiones y pocos clics
  = el título o la descripción de esa página no convence; se reescriben en `seo/pages.ts`.
- *Páginas → No indexadas*: debería haber sólo lo esperado (`/s/…`, `/admin`, rutas de la app).
- Velocidad: pasar la portada y una guía por [PageSpeed Insights](https://pagespeed.web.dev/).
  Las guías pesan pocos KB (HTML y CSS en línea); la portada carga unos 480 KB de JavaScript
  (150 KB comprimido), y si el LCP sale lento ahí está el margen.
- Una guía nueva cada una o dos semanas, sobre lo que muestre Rendimiento. Ideas: resumen de
  fin de año de un grupo, nube de palabras de un chat, qué significa "clavar el visto",
  analizar el chat de una pareja, de la familia, del trabajo o del curso.

## 5. Difusión (lo que da los primeros links)

Los links de otras páginas son lo que más tarda y más pesa. Todo esto lo hace una persona:

- Lanzamiento en Product Hunt, AlternativeTo (como alternativa a otros analizadores de chats) y
  directorios de herramientas.
- Un video corto de "mirá el Wrapped de mi grupo" para TikTok, Reels y Shorts: el formato ya
  viene hecho, y el recorrido compartido (`/s/…`) lleva a la portada.
- Reddit y comunidades (r/argentina, r/SideProject, grupos de Facebook), respetando las reglas
  de cada una. Una nota a medios de tecnología de Argentina, con el ángulo del Wrapped.
- Pedirle a gente con blog, newsletter o canal que lo pruebe y lo enlace.

## 6. Cómo agregar una página

1. Sumar el objeto a `SEO_PAGES` en `frontend/seo/pages.ts` (título hasta ~60 caracteres,
   descripción de 120 a 160, un `h1`, la fecha en `published` y `updated`).
2. Si la ruta no cuelga de `/guias/`, sumar su regla a `rewrites` en `frontend/vercel.json`.
3. `npm test`: los tests avisan si falta algo (regla, enlace roto, título largo).
4. Al cambiar el texto de una página, subir su `updated`: es el `lastmod` del sitemap.
