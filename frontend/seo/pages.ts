/**
 * El contenido de las páginas estáticas que buscan los buscadores: guías, catálogo de
 * métricas y preguntas frecuentes.
 *
 * Se escribe acá, en datos, y `render.ts` lo convierte en HTML con título, descripción,
 * canónica y datos estructurados. El texto usa el mini-markup de `markup.ts`
 * (`[texto](/ruta)`, `**negrita**`, `` `código` ``).
 *
 * Reglas para escribir (un test chequea las mecánicas):
 * - Cada página responde UNA pregunta que alguien teclea en Google, y el título la dice.
 * - Sólo afirmaciones que la app cumple de verdad. Lo que sale de la app (privacidad, cuántas
 *   métricas, qué es gratis) se contrastó contra `shellCopy.ts`, `termsText.ts` y `metrics.ts`.
 * - Sumar una página: agregarla acá, sumarle su regla en `vercel.json` (si no cuelga de
 *   `/guias/`) y subir su fecha en `updated` cuando cambie el texto.
 */

import { FREE_METRICS, PRO_METRICS, type CatalogMetric } from './catalog.ts'

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: readonly string[] }
  | { kind: 'ol'; items: readonly string[] }
  | { kind: 'h3'; id: string; text: string }

export interface Section {
  heading: string
  blocks: readonly Block[]
}

export interface Faq {
  question: string
  answer: string
}

export interface Cta {
  title: string
  body: string
  label: string
}

export interface SeoPage {
  /** La URL pública, sin barra final: `/guias/como-exportar-chat-whatsapp`. */
  path: string
  kind: 'hub' | 'guide' | 'catalog' | 'faq'
  /** Lo que se ve en la pestaña y en Google (hasta ~60 caracteres). */
  title: string
  /** El fragmento que muestra Google debajo del título (120 a 160 caracteres). */
  description: string
  h1: string
  /** La última miga de pan, más corta que el h1. */
  crumb: string
  lead: string
  published: string
  updated: string
  sections: readonly Section[]
  faq?: readonly Faq[]
  /** Otras páginas del sitio para seguir leyendo (rutas). */
  related?: readonly string[]
  cta?: Cta
}

export const PATHS = {
  guides: '/guias',
  exportChat: '/guias/como-exportar-chat-whatsapp',
  whatIsWrapped: '/guias/que-es-el-wrapped-de-whatsapp',
  messageCount: '/guias/cuantos-mensajes-hay-en-un-chat-de-whatsapp',
  replyTime: '/guias/quien-tarda-mas-en-responder-en-whatsapp',
  privacy: '/guias/es-seguro-analizar-chat-whatsapp',
  redFlags: '/guias/detector-de-red-flags-en-chats-de-whatsapp',
  metrics: '/metricas',
  faq: '/preguntas-frecuentes',
} as const

const DAY = '2026-11-09'

/** `/guias` → `guias/index.html`; el resto de las rutas, `<ruta>.html`. */
export function fileForPath(path: string): string {
  return path === PATHS.guides ? 'guias/index.html' : `${path.slice(1)}.html`
}

function metricBlocks(metrics: readonly CatalogMetric[]): Block[] {
  return metrics.flatMap((metric): Block[] => [
    { kind: 'h3', id: metric.id, text: metric.name },
    { kind: 'p', text: metric.ai ? `${metric.summary} Usa IA, con tu permiso.` : metric.summary },
  ])
}

export const SEO_PAGES: readonly SeoPage[] = [
  {
    path: PATHS.guides,
    kind: 'hub',
    title: 'Guías de WhatsApp: exportar, analizar y entender tu chat',
    description:
      'Guías prácticas para exportar un chat de WhatsApp, saber quién habla más o quién tarda en responder, y entender qué mide cada estadística de tu Wrapped.',
    h1: 'Guías para entender tu chat de WhatsApp',
    crumb: 'Guías',
    lead: 'Cada guía responde una pregunta concreta: cómo sacar el archivo del chat, qué se puede medir con él y qué pasa con tus datos en el camino.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Por dónde empezar',
        blocks: [
          {
            kind: 'p',
            text: 'Si es tu primera vez, el orden es este: [exportá el chat](/guias/como-exportar-chat-whatsapp), subilo a [Vistazo](/) y recorré tu Wrapped. Todo lo demás son preguntas que van apareciendo después, y están abajo.',
          },
        ],
      },
    ],
    related: [PATHS.metrics, PATHS.faq],
  },
  {
    path: PATHS.exportChat,
    kind: 'guide',
    title: 'Cómo exportar un chat de WhatsApp en Android y iPhone',
    description:
      'Paso a paso para exportar un chat o un grupo de WhatsApp en Android y en iPhone, con o sin multimedia, y qué hacer con el archivo .txt o .zip que sale.',
    h1: 'Cómo exportar un chat de WhatsApp en Android y iPhone',
    crumb: 'Cómo exportar un chat',
    lead: 'Exportar un chat genera un archivo con todos los mensajes de esa conversación. Sirve para guardarlo, leerlo en la compu o analizarlo, por ejemplo para ver el [Wrapped de tu chat](/guias/que-es-el-wrapped-de-whatsapp). Lleva menos de dos minutos.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Qué archivo obtenés',
        blocks: [
          {
            kind: 'p',
            text: 'WhatsApp arma un archivo de texto con la fecha, la hora, el nombre y el mensaje de cada línea. Según el teléfono y la opción que elijas, sale como un `.txt` suelto o como un `.zip` que lo contiene (con las fotos, los videos y los audios, si los incluís). [Vistazo](/) acepta los dos.',
          },
          {
            kind: 'p',
            text: 'Exportar funciona de a un chat por vez: para analizar varios, repetí los pasos con cada uno.',
          },
        ],
      },
      {
        heading: 'Cómo exportar un chat en Android',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Abrí WhatsApp y entrá al chat o al grupo que querés exportar.',
              'Tocá los tres puntitos de arriba a la derecha.',
              'Elegí **Más** y después **Exportar chat**.',
              'Elegí **Sin archivos** (en algunas versiones dice **Sin multimedia**).',
              'Elegí con qué app compartirlo: Gmail, Drive, Archivos o, si la instalaste en tu pantalla de inicio, [Vistazo](/).',
            ],
          },
        ],
      },
      {
        heading: 'Cómo exportar un chat en iPhone',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Entrá al chat o al grupo en WhatsApp.',
              'Tocá el nombre de la persona o del grupo, arriba de todo.',
              'Deslizá hasta el final y tocá **Exportar chat**.',
              'Elegí **Sin multimedia**.',
              'Tocá **Guardar en Archivos** y elegí dónde dejarlo.',
            ],
          },
        ],
      },
      {
        heading: '¿Con o sin multimedia?',
        blocks: [
          {
            kind: 'p',
            text: 'Para analizar un chat conviene exportar **sin multimedia**: el archivo es mucho más liviano y se sube enseguida. No perdés nada de lo que mide Vistazo, porque WhatsApp deja una marca en el texto cada vez que se mandó una foto, un video o un audio, y con eso se cuenta cuántos mandó cada uno.',
          },
          { kind: 'p', text: 'Si lo que querés es un respaldo completo del chat, ahí sí incluí los archivos.' },
        ],
      },
      {
        heading: 'Qué hacer con el archivo',
        blocks: [
          {
            kind: 'p',
            text: 'Subilo a [Vistazo](/) arrastrándolo o con el botón de subir. No hace falta descomprimir nada: acepta el `.txt` y el `.zip` tal como salen de WhatsApp. El análisis se hace en tu navegador, y en [esta guía](/guias/es-seguro-analizar-chat-whatsapp) explicamos qué pasa con tus datos.',
          },
          {
            kind: 'p',
            text: 'En Android, si instalás Vistazo en la pantalla de inicio, aparece como una opción más al compartir el chat y te trae de vuelta con el archivo ya cargado.',
          },
        ],
      },
      {
        heading: 'Si algo no sale',
        blocks: [
          {
            kind: 'ul',
            items: [
              '**No me aparece "Exportar chat":** actualizá WhatsApp a la última versión y abrí el menú desde adentro del chat.',
              '**El chat es larguísimo:** en conversaciones con muchos años de historial, WhatsApp puede exportar solo los mensajes más recientes.',
              '**Las fechas se ven raras:** no pasa nada. Vistazo reconoce los formatos de Android, de iPhone y de los teléfonos configurados en inglés.',
              '**No reconoce el archivo:** subí el `.txt` o el `.zip` que generó WhatsApp, sin editarlo ni cambiarle la extensión.',
            ],
          },
        ],
      },
    ],
    faq: [
      {
        question: '¿Exportar un chat borra algo?',
        answer: 'No. Exportar hace una copia: el chat sigue igual en tu teléfono.',
      },
      {
        question: '¿Se puede exportar un grupo?',
        answer: 'Sí. Entrá al grupo y seguí los mismos pasos que para un chat individual.',
      },
      {
        question: '¿Cuánto pesa el archivo?',
        answer: 'Sin multimedia, poco: un chat de solo texto suele entrar en unos pocos megas, incluso con años de historia.',
      },
    ],
    related: [PATHS.whatIsWrapped, PATHS.messageCount, PATHS.privacy],
    cta: {
      title: 'Ya tenés el archivo',
      body: 'Subilo y en segundos ves tu Wrapped. Es gratis y el análisis se hace en tu navegador.',
      label: 'Subir mi chat',
    },
  },
  {
    path: PATHS.whatIsWrapped,
    kind: 'guide',
    title: 'Wrapped de WhatsApp: qué es y cómo sacar el de tu chat',
    description:
      'Un Wrapped de WhatsApp resume tu chat como el de Spotify: quién habla más, a qué hora, con qué emojis. Mirá qué incluye y cómo sacar el tuyo gratis.',
    h1: 'Qué es el Wrapped de WhatsApp y cómo sacar el de tu chat',
    crumb: 'Qué es el Wrapped',
    lead: 'Un Wrapped de WhatsApp es un resumen de un chat armado con sus propios datos: quién habla más, a qué hora se prende la conversación, cuáles son los emojis favoritos y quién tarda en contestar. La idea viene de los resúmenes de fin de año de Spotify, aplicada a una conversación.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Qué muestra',
        blocks: [
          { kind: 'p', text: 'Vistazo calcula [25 métricas](/metricas) a partir del archivo del chat. Algunos ejemplos:' },
          {
            kind: 'ul',
            items: [
              '**Quién manda más mensajes** y quién se queda callado, mes a mes.',
              '**A qué hora y qué día de la semana** está más activo el chat.',
              '**Los emojis y las palabras** que más se repiten, por integrante.',
              '**Cuántos días seguidos** se escribieron sin cortar.',
              '**El mensaje más largo**, los más cortos y las ráfagas de mensajes.',
              '**Quién arranca la conversación** y [quién tarda más en responder](/guias/quien-tarda-mas-en-responder-en-whatsapp).',
              '**Cómo se ríe el grupo** y quién borra mensajes después de mandarlos.',
            ],
          },
          {
            kind: 'p',
            text: 'Los resultados se muestran como tarjetas, una por métrica, y se pueden recorrer como una historia.',
          },
        ],
      },
      {
        heading: 'Cómo sacar el Wrapped de tu chat',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Exportá el chat desde WhatsApp. Acá está la [guía paso a paso](/guias/como-exportar-chat-whatsapp).',
              'Subí el archivo a [Vistazo](/). Acepta `.txt` y `.zip`.',
              'Iniciá sesión con Google y recorré tu Wrapped.',
            ],
          },
          { kind: 'p', text: 'El análisis tarda unos segundos.' },
        ],
      },
      {
        heading: 'Qué es gratis y qué es Pro',
        blocks: [
          {
            kind: 'p',
            text: '13 de las 25 métricas son gratis. Las otras 12 son Pro: incluyen el [Detector de Red Flags](/guias/detector-de-red-flags-en-chats-de-whatsapp), El Clavavistos o la personalidad de cada integrante. Pro es una suscripción mensual con prueba gratis para quien se suscribe por primera vez, y se cancela cuando quieras.',
          },
        ],
      },
      {
        heading: 'Chats de a dos o grupos',
        blocks: [
          {
            kind: 'p',
            text: 'Funciona con los dos. En un chat de a dos comparás cómo escribís vos con cómo escribe la otra persona; en un grupo, cómo se reparten todos los integrantes.',
          },
        ],
      },
      {
        heading: 'Qué pasa con tu chat',
        blocks: [
          {
            kind: 'p',
            text: 'El archivo se analiza en tu navegador. El detalle de qué se guarda y qué no está en [esta guía](/guias/es-seguro-analizar-chat-whatsapp).',
          },
        ],
      },
    ],
    faq: [
      {
        question: '¿Es un Wrapped oficial de WhatsApp?',
        answer: 'No. Vistazo es un proyecto independiente, sin relación con WhatsApp ni con Meta.',
      },
      { question: '¿Cuánto tarda en estar listo?', answer: 'Unos segundos desde que subís el archivo.' },
      { question: '¿Sirve para chats de otras apps?', answer: 'Por ahora solo para exports de WhatsApp.' },
    ],
    related: [PATHS.exportChat, PATHS.metrics, PATHS.messageCount],
  },
  {
    path: PATHS.messageCount,
    kind: 'guide',
    title: 'Cuántos mensajes hay en un chat de WhatsApp y quién habla más',
    description:
      'WhatsApp no desglosa los mensajes por integrante. Exportá el chat y mirá cuántos mensajes hay, quién manda más, quién escribe más largo y quién monologuea.',
    h1: 'Cómo saber cuántos mensajes hay en un chat de WhatsApp y quién habla más',
    crumb: 'Cuántos mensajes y quién habla más',
    lead: 'En un grupo casi siempre hay alguien que escribe por cinco y alguien que nunca contesta. El problema es que WhatsApp no te muestra cuánto mandó cada integrante, así que hay que contarlo. La forma más rápida es exportar el chat y dejar que una herramienta haga la cuenta.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Lo que WhatsApp no te muestra',
        blocks: [
          {
            kind: 'p',
            text: 'WhatsApp no desglosa los mensajes por integrante ni muestra cómo cambió la actividad con el tiempo. Para eso hay que mirar el contenido del chat, mensaje por mensaje, y contarlo.',
          },
        ],
      },
      {
        heading: 'Cuánto mandó cada integrante',
        blocks: [
          {
            kind: 'p',
            text: 'Para saberlo hay que mirar el contenido del chat. Si lo [exportás](/guias/como-exportar-chat-whatsapp), [Vistazo](/) hace la cuenta por vos. Estas son las métricas que responden la pregunta:',
          },
          {
            kind: 'ul',
            items: [
              '**El Spammer vs El Silencioso** (gratis): el reparto de mensajes por integrante y cómo cambió mes a mes.',
              '**El Monologuista** (gratis): quién manda más mensajes seguidos sin que nadie conteste.',
              '**El Testamento** y **El Velocista** (gratis): los mensajes más largos y los más cortos de cada uno.',
              '**El Metralleta** (Pro): quién manda ráfagas de mensajes cortos.',
            ],
          },
        ],
      },
      {
        heading: 'Cómo hacerlo',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Exportá el chat sin multimedia ([paso a paso](/guias/como-exportar-chat-whatsapp)).',
              'Subí el archivo a [Vistazo](/).',
              'Abrí la tarjeta de El Spammer vs El Silencioso y recorré el resto del [Wrapped](/guias/que-es-el-wrapped-de-whatsapp).',
            ],
          },
        ],
      },
      {
        heading: 'Cómo leer el resultado',
        blocks: [
          {
            kind: 'p',
            text: 'Cantidad de mensajes no es lo mismo que cantidad de palabras: quien manda veinte mensajes de dos palabras pesa distinto que quien manda uno de un párrafo. Por eso conviene mirar el reparto junto con el largo de los mensajes y las rachas.',
          },
          {
            kind: 'p',
            text: 'El reparto también cuenta una historia en el tiempo. Si alguien pasó de ser el más activo a casi desaparecer, se ve en la evolución mes a mes.',
          },
        ],
      },
      {
        heading: '¿Y contarlos a mano?',
        blocks: [
          {
            kind: 'p',
            text: 'En un chat corto se puede abrir el `.txt` en una planilla y contar las líneas de cada nombre. Con años de historia deja de ser práctico: son decenas de miles de líneas, con mensajes de varios renglones y avisos del sistema mezclados.',
          },
        ],
      },
    ],
    faq: [
      {
        question: '¿Funciona en un chat de a dos?',
        answer: 'Sí. Compara cuánto escribís vos con cuánto escribe la otra persona.',
      },
      {
        question: '¿Cuenta las fotos y los audios?',
        answer:
          'Sí, aparte: la métrica de multimedia muestra quién manda más fotos, videos y audios. Alcanza con exportar sin multimedia, porque WhatsApp deja una marca en el texto por cada archivo.',
      },
    ],
    related: [PATHS.exportChat, PATHS.replyTime, PATHS.metrics],
  },
  {
    path: PATHS.replyTime,
    kind: 'guide',
    title: 'Quién tarda más en responder en WhatsApp: cómo saberlo',
    description:
      'El export de WhatsApp no muestra quién vio tu mensaje, pero sí cuándo se contestó. Así se mide quién tarda más en responder con El Clavavistos.',
    h1: 'Cómo saber quién tarda más en responder en WhatsApp',
    crumb: 'Quién tarda más en responder',
    lead: 'Todos conocemos al que te clava el visto. Lo que no se puede saber desde un chat exportado es si alguien leyó tu mensaje: esa información no viaja en el archivo. Lo que sí queda registrado es la hora a la que escribió cada uno, y con eso se mide cuánto tarda cada persona en contestar.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Qué mide El Clavavistos',
        blocks: [
          {
            kind: 'p',
            text: '[El Clavavistos](/metricas#clavavistos) calcula cuánto pasó entre un mensaje que esperaba respuesta y la contestación de la otra persona. Cuenta como mensaje que espera respuesta una pregunta, un mensaje de al menos tres palabras o un archivo multimedia; un "ok" o un emoji suelto, no.',
          },
          {
            kind: 'p',
            text: 'Con eso arma el promedio de cada integrante y un historial de las peores demoras, con la fecha y el mensaje que quedó esperando. Es una métrica Pro.',
          },
        ],
      },
      {
        heading: 'Lo que no puede decir',
        blocks: [
          {
            kind: 'p',
            text: 'No sabe si la persona vio el mensaje y no contestó, ni si estaba sin conexión o durmiendo. Mide demoras, no intenciones. Un promedio alto puede ser un hábito, un trabajo con horarios raros o una mala semana.',
          },
        ],
      },
      {
        heading: 'Otras formas de leer el silencio',
        blocks: [
          {
            kind: 'ul',
            items: [
              '**Rachas de Inactividad** muestra los silencios más largos del chat y quién rompió el hielo cada vez.',
              '**El Rompehielo** muestra quién arranca la conversación casi siempre, con el primer mensaje de cada día.',
            ],
          },
          { kind: 'p', text: 'Las dos también son Pro. [Acá está la lista completa de métricas](/metricas).' },
        ],
      },
      {
        heading: 'Cómo medirlo en tu chat',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Exportá el chat ([paso a paso](/guias/como-exportar-chat-whatsapp)).',
              'Subí el archivo a [Vistazo](/) e iniciá sesión con Google.',
              'Abrí la tarjeta de El Clavavistos.',
            ],
          },
        ],
      },
    ],
    faq: [
      {
        question: '¿Se puede saber si alguien leyó mi mensaje desde el export?',
        answer: 'No. El archivo exportado no incluye los tildes azules ni la hora en que se leyó cada mensaje.',
      },
      {
        question: '¿Sirve en grupos?',
        answer: 'Sí. Para cada integrante mide cuánto tarda en contestar después de que escribe otra persona.',
      },
    ],
    related: [PATHS.messageCount, PATHS.redFlags, PATHS.metrics],
  },
  {
    path: PATHS.privacy,
    kind: 'guide',
    title: '¿Es seguro analizar un chat de WhatsApp? Privacidad en Vistazo',
    description:
      'Qué pasa con tu chat cuando lo subís a Vistazo: se procesa en tu navegador, qué se guarda en tu cuenta y qué viaja solo si activás las métricas con IA.',
    h1: '¿Es seguro analizar un chat de WhatsApp con Vistazo?',
    crumb: 'Privacidad',
    lead: 'Un chat tiene conversaciones privadas, así que la pregunta es razonable. Acá está, sin letra chica, qué hace Vistazo con el archivo que subís y qué guarda en tu cuenta. Los detalles legales están en los [términos y condiciones](/terminos).',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Dónde se procesa tu chat',
        blocks: [
          {
            kind: 'p',
            text: 'El archivo se lee y se analiza en tu navegador, en tu propio dispositivo. Nada del chat se envía a nuestros servidores sin tu permiso.',
          },
        ],
      },
      {
        heading: 'Qué se guarda en tu cuenta',
        blocks: [
          {
            kind: 'p',
            text: 'Para ver tu Wrapped y guardarlo en tu historial iniciás sesión con Google. Lo que se guarda son los resultados: cifras, rankings y gráficos, que pueden incluir los nombres de los participantes y fragmentos breves de mensajes usados como ejemplo dentro de una métrica. El archivo del chat no se guarda.',
          },
          {
            kind: 'p',
            text: 'Podés borrar cualquier análisis desde tu historial. No vendemos datos personales ni los usamos para publicidad de terceros.',
          },
        ],
      },
      {
        heading: 'Las métricas con IA',
        blocks: [
          {
            kind: 'p',
            text: 'Tres métricas Pro usan inteligencia artificial de Google (Gemini): el Detector de Red Flags, El Tono Picante y Quién es Quién. Son opcionales: se activan recién cuando das tu permiso dentro de la app, una sola vez. Cuando las activás, a la IA viaja una selección de mensajes, según la métrica:',
          },
          {
            kind: 'ul',
            items: [
              '**Red Flags y Tono Picante:** los mensajes que marcó el filtro de palabras, con un par de líneas de contexto. En Red Flags, además, los últimos 5.000 mensajes del chat y algunos tramos anteriores.',
              '**Quién es Quién:** hasta 40 mensajes cortos de cada integrante (de las 8 personas que más escriben) y números sobre cómo escribe.',
            ],
          },
          {
            kind: 'p',
            text: 'Antes de salir de tu navegador, cada participante pasa a ser una letra, y los nombres, links, mails y teléfonos que haya dentro de los mensajes se reemplazan o se sacan. El resultado se guarda una sola vez por chat; el detalle de qué se conserva está en los [términos](/terminos).',
          },
        ],
      },
      {
        heading: 'Qué queda en tu dispositivo',
        blocks: [
          {
            kind: 'p',
            text: 'La app guarda en el almacenamiento del navegador la sesión, tus preferencias y un identificador del dispositivo, necesarios para que funcione.',
          },
        ],
      },
      {
        heading: 'Si compartís tu Wrapped',
        blocks: [
          {
            kind: 'p',
            text: 'Desde el recorrido podés compartir un link. Esos links duran 90 días, y quien los abre ve el recorrido, no tu chat completo.',
          },
        ],
      },
      {
        heading: 'Cómo pedir que se borren tus datos',
        blocks: [
          {
            kind: 'p',
            text: 'Los análisis se borran uno por uno desde tu historial. Para eliminar la cuenta y todos sus datos, escribinos desde la página de [ayuda](/ayuda); si tenés una suscripción activa, cancelala antes para que no se generen nuevos cobros.',
          },
        ],
      },
    ],
    faq: [
      {
        question: '¿Vistazo ve mis mensajes?',
        answer:
          'El análisis básico ocurre en tu navegador y nuestros servidores no reciben el chat. Las métricas con IA son la excepción y requieren tu permiso.',
      },
      {
        question: '¿Hace falta iniciar sesión?',
        answer: 'Sí, con Google, para ver y guardar tu Wrapped. Es gratis.',
      },
    ],
    related: [PATHS.exportChat, PATHS.redFlags, PATHS.faq],
  },
  {
    path: PATHS.redFlags,
    kind: 'guide',
    title: 'Detector de red flags en chats de WhatsApp: cómo funciona',
    description:
      'El Detector de Red Flags de Vistazo busca en tu chat de WhatsApp patrones como celos, insultos, culpa, chantaje, borrados y silencios largos. Así funciona.',
    h1: 'Detector de red flags en chats de WhatsApp: cómo funciona',
    crumb: 'Detector de red flags',
    lead: 'Una red flag en un chat es una señal que se repite, no una frase suelta. El Detector de Red Flags de Vistazo junta esas señales en un solo lugar para que veas el patrón con su fecha y su contexto.',
    published: DAY,
    updated: DAY,
    sections: [
      {
        heading: 'Qué patrones busca',
        blocks: [
          {
            kind: 'p',
            text: 'Por un lado, categorías de frases, como celos, insultos, culpa o chantaje. Por otro, dos señales que no dependen de las palabras:',
          },
          {
            kind: 'ul',
            items: [
              '**Borrados:** cuántos mensajes se eliminaron después de mandarlos.',
              '**Silencios largos:** pausas de dos días o más sin que nadie escriba.',
            ],
          },
          {
            kind: 'p',
            text: 'El resultado es un desglose: cuántos mensajes hay de cada tipo, quién los escribió y los momentos señalados, con la conversación que los rodea.',
          },
        ],
      },
      {
        heading: 'Cómo se usa la IA',
        blocks: [
          {
            kind: 'p',
            text: 'Un filtro de palabras solo se equivoca seguido: "la comida estaba caliente" no es un mensaje subido de tono. Por eso la IA de Google (Gemini) revisa los mensajes que marcó el filtro y descarta los que no corresponden. En Red Flags, además, lee los mensajes más recientes del chat para encontrar lo que ninguna palabra marcó.',
          },
          {
            kind: 'p',
            text: 'La IA se activa solo con tu permiso, una vez. Qué viaja y cómo se protegen los nombres está explicado en [esta guía](/guias/es-seguro-analizar-chat-whatsapp).',
          },
        ],
      },
      {
        heading: 'Cómo verlo en tu chat',
        blocks: [
          {
            kind: 'ol',
            items: [
              'Exportá el chat ([paso a paso](/guias/como-exportar-chat-whatsapp)).',
              'Subí el archivo a [Vistazo](/) e iniciá sesión con Google.',
              'Abrí la tarjeta Red Flags y activá el análisis con IA.',
            ],
          },
          { kind: 'p', text: 'El Detector de Red Flags es una métrica Pro.' },
        ],
      },
    ],
    faq: [
      {
        question: '¿Sirve para parejas, amigos y grupos?',
        answer: 'Funciona con cualquier chat, de a dos o grupal. Los patrones se cuentan por integrante.',
      },
    ],
    related: [PATHS.replyTime, PATHS.privacy, PATHS.metrics],
  },
  {
    path: PATHS.metrics,
    kind: 'catalog',
    title: 'Las 25 métricas de Vistazo para tu chat de WhatsApp',
    description:
      'Todas las estadísticas que Vistazo calcula de un chat de WhatsApp: 13 gratis y 12 Pro. Quién habla más, a qué hora, quién tarda en responder y mucho más.',
    h1: 'Las 25 métricas que Vistazo calcula de tu chat',
    crumb: 'Métricas',
    lead: 'Cada Wrapped de Vistazo se arma con 25 métricas: 13 son gratis y 12 son Pro. Esta es la lista completa, con lo que muestra cada una.',
    published: DAY,
    updated: DAY,
    sections: [
      { heading: `Métricas gratis (${FREE_METRICS.length})`, blocks: metricBlocks(FREE_METRICS) },
      { heading: `Métricas Pro (${PRO_METRICS.length})`, blocks: metricBlocks(PRO_METRICS) },
    ],
    related: [PATHS.whatIsWrapped, PATHS.exportChat, PATHS.faq],
    cta: {
      title: 'Mirá cuáles te tocan',
      body: 'Subí tu chat y en segundos ves las métricas con tus datos. Las gratis están a un click.',
      label: 'Probar con mi chat',
    },
  },
  {
    path: PATHS.faq,
    kind: 'faq',
    title: 'Preguntas frecuentes sobre Vistazo y el Wrapped de WhatsApp',
    description:
      'Respuestas a las dudas más comunes sobre Vistazo: si es gratis, cómo exportar el chat, qué datos se guardan, cómo funciona Pro y cómo se cancela.',
    h1: 'Preguntas frecuentes',
    crumb: 'Preguntas frecuentes',
    lead: 'Lo que más se pregunta sobre Vistazo, con respuestas cortas y links a las guías por si querés más detalle.',
    published: DAY,
    updated: DAY,
    sections: [],
    faq: [
      {
        question: '¿Qué es Vistazo?',
        answer:
          'Una app web que convierte el chat de WhatsApp que exportás en un Wrapped: 25 métricas sobre quién habla más, a qué hora, quién tarda en responder y mucho más, presentadas como tarjetas que se recorren como una historia.',
      },
      {
        question: '¿Es gratis?',
        answer:
          'Empezás gratis y sin tarjeta: 13 de las 25 métricas son gratis. Las otras 12 son Pro, una suscripción mensual con prueba gratis para quien se suscribe por primera vez.',
      },
      {
        question: '¿Cómo exporto mi chat de WhatsApp?',
        answer:
          'Desde el menú del chat. En Android: tres puntitos, Más, Exportar chat. En iPhone: tocá el nombre del chat y después Exportar chat. Elegí la opción sin multimedia. Los pasos completos están en la [guía para exportar un chat](/guias/como-exportar-chat-whatsapp).',
      },
      {
        question: '¿Qué archivos acepta?',
        answer:
          'El `.txt` o el `.zip` que genera WhatsApp, tal como salen. Reconoce los formatos de fecha de Android, de iPhone y de teléfonos configurados en inglés.',
      },
      {
        question: '¿Vistazo lee mis mensajes?',
        answer:
          'El análisis se hace en tu navegador y nada del chat se envía a nuestros servidores sin tu permiso. La excepción son tres métricas Pro con IA, que se activan solo si das tu consentimiento. Está todo explicado en la [guía de privacidad](/guias/es-seguro-analizar-chat-whatsapp).',
      },
      {
        question: '¿Por qué tengo que iniciar sesión con Google?',
        answer: 'Para mostrarte tu Wrapped y guardarlo en tu historial. Iniciar sesión es gratis.',
      },
      {
        question: '¿Qué se guarda de mi chat?',
        answer: 'Si guardás el análisis, los resultados: cifras, rankings y gráficos. El archivo del chat no se guarda.',
      },
      {
        question: '¿Funciona con grupos?',
        answer: 'Sí, con grupos y con chats de a dos. Las métricas se calculan por integrante.',
      },
      {
        question: '¿Necesito instalar algo?',
        answer:
          'No. Funciona desde el navegador, y si querés podés instalarla en la pantalla de inicio. En Android, una vez instalada aparece como opción al compartir el chat desde WhatsApp.',
      },
      {
        question: '¿Funciona en iPhone?',
        answer: 'Sí. En iPhone se exporta el chat, se guarda en Archivos y se sube desde la web.',
      },
      {
        question: '¿En qué idiomas está?',
        answer: 'En español y en inglés. El idioma se cambia desde el menú de la app.',
      },
      {
        question: '¿Cómo se paga Pro y cómo se cancela?',
        answer:
          'Se paga con Mercado Pago. Se cancela cuando quieras desde la pantalla de la suscripción, y conservás el acceso hasta que termina el período que ya pagaste.',
      },
      {
        question: '¿Puedo borrar mis datos?',
        answer:
          'Sí. Los análisis se borran desde el historial, y para eliminar la cuenta y todos sus datos escribinos desde la página de [ayuda](/ayuda).',
      },
      {
        question: '¿Vistazo tiene relación con WhatsApp?',
        answer: 'No. Es un proyecto independiente, sin relación con WhatsApp ni con Meta.',
      },
      {
        question: '¿Funciona con otras apps de mensajes?',
        answer: 'Por ahora solo con exports de WhatsApp.',
      },
    ],
    related: [PATHS.exportChat, PATHS.privacy, PATHS.metrics],
  },
]

export function pageByPath(path: string): SeoPage | undefined {
  return SEO_PAGES.find((page) => page.path === path)
}
