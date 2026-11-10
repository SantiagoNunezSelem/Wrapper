import type { Language } from '../types'

/**
 * Un export de WhatsApp inventado, para que la landing muestre las métricas reales
 * corriendo sobre algo — ver `landingPreview.ts`.
 *
 * Antes las tarjetas de ejemplo estaban escritas a mano y quedaron viejas en cuanto las
 * métricas cambiaron (la tensión seguía siendo un puntaje 0-100 que ya no existía). Así,
 * lo que ve un visitante es exactamente lo que va a ver con su chat: mismas tarjetas,
 * mismos gráficos, mismo detalle con los mensajes de adentro.
 *
 * El chat está guionado, no sorteado: cada escena es una conversación corta con
 * principio y fin, y ninguna se repite. El detalle de cada métrica muestra los mensajes
 * reales que la explican, así que un chat armado con frases al azar se leía como
 * ruido ("hoy en el laburo" tres veces seguidas, sin contexto).
 *
 * Tiene que cumplir dos cosas para que los ejemplos funcionen:
 *  - Los cuatro pasan de los 50 mensajes de texto (`MIN_MESSAGES_PER_PERSON`). Con menos,
 *    "La personalidad de cada integrante" no tiene de dónde leer y la tarjeta ni aparece.
 *  - Cada escena termina con un mensaje corto y sin pregunta. Si terminara con una pregunta,
 *    el primer mensaje de la escena siguiente —uno o dos días después— contaría como la
 *    respuesta, y "Quién tarda más en responder" mostraría "Nico tardó 6 días" sin ninguna
 *    conversación detrás. Un test lo vigila.
 *
 * Todo es ficticio — nombres, mensajes, links — y determinístico: la semilla es fija,
 * así que la landing muestra siempre los mismos números y los tests pueden fijarlos.
 */

type Person = 'Fran' | 'Vale' | 'Nico' | 'Caro'

/** Minutos que tarda cada uno en contestar cuando le toca: Vale es la velocista, Caro
 * clava el visto. Los mensajes seguidos de una misma persona salen casi pegados.
 * Caro no pasa de las tres horas: pasado ese tiempo su respuesta contaría como que ella
 * "arrancó una conversación" (ver `OPENING_GAP_MS` en personality.ts), que es lo contrario
 * de lo que se quiere mostrar de ella. */
const REPLY_MINUTES: Record<Person, [number, number]> = {
  Fran: [1, 5],
  Vale: [0, 2],
  Nico: [2, 12],
  Caro: [50, 170],
}

/** Horas en que arranca una charla sin hora propia, cargadas hacia la noche. */
const SESSION_HOURS = [13, 18, 20, 21, 22, 22, 23, 23]

const MEDIA = { es: '<Multimedia omitido>', en: '<Media omitted>' }
const DELETED = { es: 'Se eliminó este mensaje', en: 'This message was deleted' }

/** Una línea: quién habla y qué dice en cada idioma. `MEDIA`/`DELETED` son los
 * marcadores que WhatsApp escribe en el export. El cuarto valor, si está, son los minutos
 * que pasan desde el mensaje anterior cuando cambia quien habla, en vez de lo que esa
 * persona tarda de costumbre: para que Caro conteste enseguida cuando está conectada. */
type Line = [Person, string | typeof MEDIA, string?, number?]

interface Scene {
  lines: Line[]
  /** Hora de arranque, cuando la escena la pide ("¿alguien despierto?"). */
  hour?: number
  /** Días de silencio antes de esta escena, además del día que avanza siempre.
   * Alimentan "Rachas de inactividad" y los silencios del detector de red flags. */
  silenceBefore?: number
}

const LONG_INTERVIEW_ES =
  'bueno les cuento porque si no exploto: hoy fui a la entrevista, me hicieron esperar una hora, después me preguntaron cosas que no tenían nada que ver con el puesto y al final me dijeron que me llamaban. Salí, me tomé el colectivo equivocado y terminé en otro barrio. Así que nada, día redondo, mañana sigo buscando'
const LONG_INTERVIEW_EN =
  "ok I need to vent: went to the interview today, they made me wait an hour, then asked me stuff that had nothing to do with the job and at the end said they'd call me. I walked out, took the wrong bus and ended up across town. So yeah, perfect day, back to job hunting tomorrow"
const LONG_THANKS_ES =
  'les quiero decir algo en serio: gracias por bancarme este año, sé que estuve insoportable con la mudanza y con todo lo del laburo, pero cada vez que abría este chat me reía un rato. Los quiero mucho, aunque Fran no escuche nunca los audios'
const LONG_THANKS_EN =
  "real talk for a sec: thanks for putting up with me this year, I know I was unbearable with the move and all the work stuff, but every time I opened this chat I laughed a little. Love you all, even if Fran never listens to the voice notes"

/** El chat entero, en orden. Fran cuenta historias sin que nadie conteste
 * (Monologuista) y grita en mayúsculas (Dramático), Vale contesta al toque y reparte
 * cariño, Nico organiza los planes, Caro contesta horas después, y Nico y Vale tienen
 * sus momentos de tensión (Red flags). */
const SCENES: Scene[] = [
  {
    lines: [
      // Fran abre el chat: el orden de aparición decide los colores de cada uno y el
      // orden de los ejemplos en varias métricas, y Fran es la protagonista.
      ['Fran', '¿qué hacemos el viernes?', 'what are we doing friday?'],
      ['Vale', 'yo puedo desde las 9', "I'm free after 9"],
      ['Nico', '¿asado en lo de Caro?', "bbq at Caro's?"],
      ['Fran', 'Caro??', 'Caro??'],
      ['Vale', 'jajaja la invocaste', 'hahaha you summoned her'],
      ['Caro', 'perdón, estaba en el laburo. sí, vengan', 'sorry, was at work. yes, come over'],
      ['Fran', 'YO LLEVO EL FERNET', "I'M BRINGING DRINKS"],
      // Termina en otra persona a propósito: la escena que sigue es un monólogo de Fran,
      // y si esta cerrara con ella la racha se comería este mensaje también.
      ['Nico', 'listo, a las 9 en lo de Caro', "done, 9pm at Caro's"],
      ['Vale', '👌'],
    ],
  },
  {
    lines: [
      ['Fran', 'chicos', 'guys'],
      ['Fran', 'no saben lo que me pasó', "you won't believe what just happened"],
      ['Fran', 'estaba en el súper', 'I was at the supermarket'],
      ['Fran', 'y me cruzo a la profe de química del secundario', 'and I run into my high school chemistry teacher'],
      ['Fran', 'me saluda re efusiva', 'she greets me super excited'],
      ['Fran', 'y yo no me acordaba el nombre', "and I couldn't remember her name"],
      ['Fran', "le dije 'hola señora' 😭", "I said 'hi ma'am' 😭"],
      ['Fran', 'hola??', 'hello??'],
      ['Vale', 'JAJAJAJA señora', "HAHAHA ma'am"],
    ],
  },
  {
    lines: [
      ['Vale', MEDIA],
      ['Vale', 'miren el meme que me mandó mi vieja', 'look at the meme my mom sent me'],
      ['Nico', 'JAJAJAJAJA', 'HAHAHAHAHA'],
      ['Fran', 'askjdhaksjd no puedo', "asdfghjkl I can't"],
      ['Caro', 'jajaja tu vieja es la mejor', 'hahaha your mom is the best'],
      ['Vale', 'le enseñé a usar stickers y no para', "I taught her stickers and she won't stop"],
      ['Nico', '😂'],
    ],
  },
  {
    lines: [
      ['Nico', '¿con quién estabas anoche?', 'who were you with last night?'],
      ['Vale', 'con las chicas, te dije', 'with the girls, I told you'],
      ['Nico', 'me dejaste en visto tres horas', "where were you? no answer for three hours"],
      ['Vale', 'me quedé sin batería', 'my phone died'],
      ['Nico', 'no te creo nada', "you're hiding something"],
      ['Fran', 'chicos, esto es el grupo 😬', 'guys, this is the group chat 😬'],
      ['Vale', 'perdón 🙈', 'sorry 🙈'],
    ],
  },
  {
    lines: [
      ['Vale', 'Caro, ¿me pasás el apunte de hoy?', "Caro, can you send me today's notes?"],
      ['Vale', 'cuando puedas', 'whenever you can'],
      ['Caro', MEDIA],
      ['Caro', 'perdón, recién veo', 'sorry, just saw this'],
      ['Vale', 'genia ❤️', 'legend ❤️'],
    ],
  },
  {
    // Nico organiza y Caro contesta horas después de que Vale le preguntó.
    lines: [
      ['Nico', 'chicos, el domingo es el cumple de mi hermana', "guys, sunday is my sister's birthday"],
      ['Nico', 'a las 4 en casa, vengan', 'at 4 at my place, come over'],
      ['Fran', 'yo llevo la torta!!', "I'm bringing the cake!!"],
      ['Vale', 'yo el helado, ya dije', "I've got the ice cream, calling it"],
      ['Vale', 'Caro, ¿venís?', 'Caro, are you coming?'],
      ['Caro', 'sí, voy', "yes, I'll be there"],
      ['Caro', 'llevo las gaseosas', "I'll bring the sodas"],
      ['Nico', 'listo, ya está todo', 'great, that is everything'],
      ['Vale', '🥰'],
    ],
  },
  {
    lines: [
      ['Fran', 'bueno, les cuento lo de la cita', 'ok, update on the date'],
      ['Fran', 'llegó 40 minutos tarde', 'he showed up 40 minutes late'],
      ['Fran', 'pidió por los dos sin preguntar', 'ordered for both of us without asking'],
      ['Fran', 'y al final me pidió que pague la mitad', 'and then asked me to split the bill'],
      ['Fran', 'igual era lindo', 'he was cute though'],
      ['Fran', 'no me juzguen', "don't judge me"],
      ['Nico', 'te juzgamos un poco', "we're judging a little"],
      ['Vale', 'jajaja un poco mucho', 'haha more than a little'],
      ['Caro', 'qué mal el chico', 'bad date honestly'],
      ['Fran', 'sos un tarado, Nico 😒', "you're a jerk, Nico 😒"],
      ['Nico', 'jaja', 'haha'],
    ],
  },
  {
    hour: 20,
    lines: [
      ['Nico', 'https://open.spotify.com/track/vistazo-demo'],
      ['Nico', 'temazo para el viaje', 'banger for the road trip'],
      ['Vale', '¡sumalo a la playlist!', 'add it to the playlist!'],
      ['Nico', 'https://open.spotify.com/playlist/vistazo-demo'],
      ['Fran', 'esa playlist dura 4 horas jaja', 'that playlist is 4 hours long haha'],
      ['Caro', 'qué temazo', 'total banger'],
    ],
  },
  {
    lines: [
      ['Vale', LONG_INTERVIEW_ES, LONG_INTERVIEW_EN],
      ['Fran', 'noooo qué horror', "nooo that's awful"],
      ['Nico', 'ya va a salir algo mejor, vas a ver', "something better will come up, you'll see"],
      ['Caro', 'te invito un café el finde ❤️', 'coffee on me this weekend ❤️'],
      ['Vale', '❤️'],
    ],
  },
  {
    lines: [
      ['Fran', MEDIA],
      ['Fran', '¿cómo me queda?', 'how do I look?'],
      ['Vale', 'estás para comerte 🔥', 'you look so hot 🔥'],
      ['Caro', 'uff qué sexy ese look', 'ok that outfit is sexy'],
      ['Fran', 'ay basta jaja', 'stop it haha'],
      ['Nico', 'qué picante está el grupo hoy', 'things are getting hot in here'],
      ['Fran', 'jajaja', 'hahaha'],
    ],
  },
  {
    lines: [
      ['Fran', 'el gato rompió otro vaso', 'the cat broke another glass'],
      ['Fran', 'me miró a los ojos mientras lo tiraba', 'looked me in the eyes while pushing it off'],
      ['Fran', 'es personal', "it's personal"],
      ['Fran', MEDIA],
      ['Fran', 'miren esa cara de culpable', 'look at that guilty face'],
      ['Fran', 'cero culpa, en realidad', 'zero guilt, actually'],
      ['Caro', 'amo a ese gato 😍', 'I love that cat 😍'],
      ['Fran', 'gracias 😌', 'thanks 😌'],
    ],
  },
  {
    // Vale rompe el silencio y Caro aparece tres horas después con una excusa.
    silenceBefore: 3,
    lines: [
      ['Vale', 'Caro, ¿estás viva? hace días que no decís nada', "Caro, are you alive? you haven't said a word in days"],
      ['Fran', 'la perdimos otra vez', 'we lost her again'],
      ['Nico', 'seguro la secuestró el laburo', 'work must have kidnapped her'],
      ['Caro', 'estoy viva, perdón', "I'm alive, sorry"],
      ['Caro', 'el laburo me está comiendo', 'work is eating me alive'],
      ['Caro', 'reuniones hasta las 9 todos los días', 'meetings until 9pm every single day'],
      ['Vale', 'te extraño mucho ❤️', 'I miss you so much ❤️'],
      ['Caro', 'yo también', 'me too', 2],
    ],
  },
  {
    lines: [
      ['Vale', 'chicos, les tengo que confesar algo', 'guys, I have to confess something'],
      ['Vale', DELETED],
      ['Nico', '¿qué borraste??', 'what did you delete??'],
      ['Fran', 'no, ahora lo decís', 'no, now you have to say it'],
      ['Vale', 'nada, nada 🙈', 'nothing, nothing 🙈'],
      ['Fran', 'ME MUERO DE LA INTRIGA', 'THE SUSPENSE IS KILLING ME'],
      ['Vale', '🙊'],
    ],
  },
  {
    lines: [
      ['Fran', '¿a qué hora es mañana?', 'what time is it tomorrow?'],
      ['Fran', '¿llevamos algo?', 'should we bring something?'],
      ['Fran', '¿Caro viene?', 'is Caro coming?'],
      ['Nico', 'a las 8, llevá hielo', 'at 8, bring ice'],
      ['Fran', '¿cuánto hielo?', 'how much ice?'],
      ['Nico', 'sos un boludo, Fran. hielo.', "you're a jerk, Fran. just ice."],
      ['Vale', 'jajaja', 'hahaha'],
    ],
  },
  {
    silenceBefore: 4,
    lines: [
      ['Nico', 'Caro, ¿confirmás para el sábado?', 'Caro, are you in for saturday?'],
      ['Fran', 'la perdimos', 'we lost her'],
      ['Caro', '¡sí!! perdón, estaba en el cine', 'yes!! sorry, I was at the movies'],
      ['Nico', '¿qué viste?', 'what did you see?'],
      ['Caro', 'una de terror, no dormí nada 😭', "a horror movie, didn't sleep at all 😭"],
      ['Nico', 'jaja', 'haha'],
    ],
  },
  {
    hour: 18,
    lines: [
      ['Nico', 'https://maps.app.goo.gl/vistazo-demo'],
      ['Nico', 'acá es el bar del sábado', 'this is the bar for saturday'],
      ['Caro', 'queda lejísimos', "that's so far"],
      ['Nico', 'hay combi, no se quejen', "there's a shuttle, stop complaining"],
      ['Vale', 'yo manejo a la vuelta', "I'll drive back"],
      ['Nico', 'perfecto', 'perfect'],
    ],
  },
  {
    lines: [
      ['Caro', MEDIA],
      ['Caro', MEDIA],
      ['Caro', '¡fotos del sábado!', 'saturday pics!'],
      ['Fran', 'borren la mía por favor', 'delete mine please'],
      ['Nico', 'demasiado tarde, ya es mi fondo de pantalla', "too late, it's my wallpaper now"],
      ['Fran', 'ay no 🙈', 'oh no 🙈'],
    ],
  },
  {
    // Fran, la dramática, le reclama a Caro por tardar: celos y reproches de entre casa.
    lines: [
      ['Fran', 'Caro, me dejaste en visto toda la tarde', 'Caro, where were you? you left me on read all afternoon'],
      ['Fran', 'no te importa nada lo que te cuento', "you don't care about me, admit it"],
      ['Vale', 'Fran, estaba trabajando', 'Fran, she was working'],
      ['Caro', 'perdón, estaba en una reunión', 'sorry, I was in a meeting'],
      ['Fran', 'te perdono, pero sos lenta', "forgiven, but you're slow"],
      ['Caro', 'jaja', 'haha', 3],
    ],
  },
  {
    lines: [
      ['Vale', '¿quién te escribió recién?', 'who texted you just now?'],
      ['Nico', 'mi hermana', 'my sister'],
      ['Vale', '¿con quién hablabas a esta hora?', 'who were you with at this hour?'],
      ['Nico', '¿estás celosa?', "you're so jealous"],
      ['Vale', 'no, pero siempre lo mismo con vos', 'no, but let me see your phone'],
      ['Caro', 'yo me voy a dormir 😂', "I'm going to sleep 😂"],
      ['Vale', '🙄'],
    ],
  },
  {
    // La pelea de la pareja del grupo, con Fran de testigo. Cada mensaje cae en una sola
    // categoría de Red Flags (celos, reproche, insulto, ruptura), para que cada torta se lea.
    hour: 22,
    lines: [
      ['Nico', 'otra vez me dejaste en visto', "you're hiding something again"],
      ['Vale', 'estaba trabajando, Nico', 'I was working, Nico'],
      ['Nico', 'siempre tenés una excusa', 'you always have an excuse'],
      ['Vale', 'siempre hacés lo mismo', 'you ruin everything'],
      ['Nico', 'es tu culpa, no me contestás', "it's your fault, you never answer me"],
      ['Vale', 'sos un pelotudo', "you're a jerk"],
      ['Fran', 'chicos, por favor, el grupo', 'guys, please, the group chat'],
      ['Nico', 'no doy más con esto', "I can't do this anymore"],
      ['Vale', 'necesito un tiempo', 'I need space'],
      ['Vale', DELETED],
      ['Nico', 'ok', 'fine'],
    ],
  },
  {
    hour: 13,
    lines: [
      ['Vale', 'perdón por lo de ayer', 'sorry about yesterday'],
      ['Nico', 'yo también, me pasé', 'me too, I went too far'],
      ['Fran', 'por fin, tenían al grupo en vilo', 'finally, you had the whole group on edge'],
      ['Vale', 'jaja perdón Fran', 'haha sorry Fran'],
      ['Caro', 'me alegro mucho', "I'm so glad"],
      ['Caro', 'los quiero a los dos', 'love you both'],
      ['Vale', '❤️'],
    ],
  },
  {
    lines: [
      ['Fran', 'estoy atrapada en el bondi', "I'm stuck on the bus"],
      ['Fran', 'hace 40 minutos que no se mueve', "it hasn't moved in 40 minutes"],
      ['Fran', 'el chofer se bajó a comprar algo', 'the driver got off to buy something'],
      ['Fran', 'volvió con un alfajor', 'came back with a snack'],
      ['Fran', 'y no nos convidó', "and didn't share"],
      ['Fran', '¡¡ESTO ES UN ESCÁNDALO!!', 'THIS IS OUTRAGEOUS!!'],
      ['Fran', 'nadie me contesta', "nobody's answering"],
      ['Fran', 'genial', 'great'],
    ],
  },
  {
    lines: [
      ['Nico', 'mañana es el cumple de Vale', "tomorrow is Vale's birthday"],
      ['Fran', '¿¿QUÉ?? ME OLVIDÉ POR COMPLETO', 'WHAT?? I TOTALLY FORGOT'],
      ['Nico', 'por eso aviso jaja', "that's why I'm saying haha"],
      ['Caro', '¿armamos vaquita para el regalo?', 'should we chip in for a gift?'],
      ['Fran', 'sí sí, yo pongo', "yes yes, I'm in"],
    ],
  },
  {
    hour: 9,
    lines: [
      ['Fran', '¡¡¡FELIZ CUMPLE VALE!!! 🎉🎉', 'HAPPY BIRTHDAY VALE!!! 🎉🎉'],
      ['Nico', '¡feliz cumple!! te queremos', 'happy birthday!! love you'],
      ['Caro', 'que la pases hermoso ❤️', 'have the best day ❤️'],
      ['Vale', 'graciaaas, los amo 😭', 'thank youuu, love you all 😭'],
      ['Vale', MEDIA],
      ['Fran', 'qué linda esa torta', 'that cake looks amazing'],
      ['Vale', 'gracias 🥰', 'thanks 🥰'],
    ],
  },
  {
    hour: 1,
    lines: [
      ['Nico', '¿alguien despierto?', 'anyone awake?'],
      ['Fran', 'obvio', 'obviously'],
      ['Nico', 'no puedo dormir', "can't sleep"],
      ['Fran', 'yo tampoco, estoy viendo videos de gatos', 'me neither, watching cat videos'],
      ['Fran', 'https://www.tiktok.com/@vistazo/video/1'],
      ['Nico', 'jajaja ese gato sos vos', "hahaha that cat is you"],
      ['Fran', 'touché', 'touché'],
    ],
  },
  {
    lines: [
      ['Fran', 'terminé la serie', 'finished the show'],
      ['Fran', 'NO PUEDE SER ESE FINAL', 'THAT ENDING, NO WAY'],
      ['Fran', 'necesito hablarlo con alguien', 'I need to talk about it'],
      ['Fran', '¿quién la vio?', 'who watched it?'],
      ['Fran', 'bueno, nadie', 'ok, nobody'],
      ['Fran', 'les dejo el link así la empiezan', "here's the link so you can start it"],
      ['Fran', 'https://www.netflix.com/title/vistazo-demo'],
      ['Nico', 'spoileame y te bloqueo', "spoil it and I'll block you"],
      ['Fran', 'ni loca', 'no way'],
    ],
  },
  {
    hour: 9,
    lines: [
      ['Vale', 'odio los lunes', 'I hate mondays'],
      ['Caro', 'mood', 'mood'],
      ['Nico', 'ánimo, que el viernes está cerca', "hang in there, friday's close"],
      ['Fran', 'faltan 4 días, Nico', "it's 4 days away, Nico"],
      ['Nico', 'amargo', 'bitter'],
    ],
  },
  {
    // Caro pregunta y los demás le contestan al toque: ella es la que tarda en volver.
    lines: [
      ['Caro', '¿alguien me recomienda una serie?', 'does anyone have a show recommendation?'],
      ['Vale', 'la que terminó Fran!!', 'the one Fran just finished!!'],
      ['Fran', 'SIII ES LA MEJOR', 'YESSS IT IS THE BEST'],
      ['Nico', 'la de los mellizos también', 'the one with the twins too'],
      ['Caro', 'gracias, las anoto', 'thanks, noting them down'],
      ['Caro', 'mañana arranco', 'starting tomorrow'],
      ['Vale', '🎬'],
    ],
  },
  {
    // Caro, la tímida, trae una noticia: lo que cuenta es lo que más le cuesta del chat.
    hour: 20,
    lines: [
      ['Nico', '¿alguien sabe algo de Caro? hoy tenía la presentación grande', 'anyone heard from Caro? she had the big presentation today'],
      ['Vale', 'estoy a mil con los nervios por ella', "I'm so nervous for her"],
      ['Caro', 'chicos, tengo una noticia', 'guys, I have news'],
      ['Caro', 'me ascendieron', 'I got promoted'],
      ['Fran', 'NOOOO!! FELICITACIONES!!!', 'NOOOO!! CONGRATULATIONS!!!'],
      ['Vale', 'sabía que podías 😭❤️', 'I knew you could do it 😭❤️'],
      ['Nico', 'esto se festeja, salimos el viernes', "we're celebrating, let's go out on friday"],
      ['Caro', 'gracias, los quiero', 'thank you, love you guys', 3],
      ['Fran', '🎉🎉🎉'],
    ],
  },
  {
    lines: [
      ['Vale', 'anoche soñé con alguien de acá', 'I dreamed about someone in here last night'],
      ['Nico', '¿quién??', 'who??'],
      ['Vale', 'no pienso decir nada 😏', 'not saying 😏'],
      ['Fran', 'me tenés loca con la intriga', "you're so flirty today"],
      ['Caro', 'sensual el grupo esta semana', 'the group is naughty this week'],
      ['Vale', 'jajaja', 'hahaha'],
    ],
  },
  {
    lines: [
      ['Nico', 'llueve un montón, ojo si salen', "it's pouring, careful out there"],
      ['Vale', 'me mojé entera 😭', 'I got completely soaked 😭'],
      ['Vale', MEDIA],
      ['Fran', 'JAJAJA parecés un pollito', 'HAHAHA you look like a wet chick'],
    ],
  },
  {
    lines: [
      ['Fran', '¿a dónde fuiste que no viniste al cumple?', 'where did you go? you missed the birthday'],
      ['Nico', 'me quedé dormido', 'I fell asleep'],
      ['Fran', 'algo me ocultás', "you're up to something"],
      ['Nico', 'nada jajaja, lo juro', 'nothing haha, I swear'],
      ['Vale', 'sospechoso', 'suspicious'],
    ],
  },
  {
    // Nico y Fran se arrepienten de algo que escribieron: dos borrados más para la torta.
    lines: [
      ['Nico', DELETED],
      ['Fran', 'vi lo que escribiste antes de borrarlo', 'I saw what you wrote before you deleted it'],
      ['Nico', 'era para otro chat 🙈', 'it was meant for another chat 🙈'],
      ['Fran', 'a mí no me engañás, boludo', "you're not fooling me, jerk"],
      ['Fran', DELETED],
      ['Vale', 'ahora vos, Fran, ¿qué borraste?', 'now you, Fran, what did you delete?'],
      ['Fran', 'nada que les importe', 'nothing you need to know'],
      ['Nico', 'jajaja', 'hahaha'],
    ],
  },
  {
    lines: [
      ['Fran', 'arranqué el gimnasio', 'I started going to the gym'],
      ['Fran', 'fui una vez', 'went once'],
      ['Fran', 'me duele todo', 'everything hurts'],
      ['Fran', 'no puedo ni levantar el celular', "can't even lift my phone"],
      ['Fran', 'igual estoy escribiendo, así que miento', "I'm typing though, so I'm lying"],
      ['Fran', 'mañana no voy', 'not going tomorrow'],
      ['Caro', 'jajaja clásico', 'hahaha classic'],
    ],
  },
  {
    // La Caro de la hora del almuerzo: conectada, contesta en minutos.
    hour: 14,
    lines: [
      ['Caro', 'estoy en el almuerzo, ¿hay alguien?', 'on my lunch break, anyone around?'],
      ['Vale', 'acá!!', 'here!!'],
      ['Caro', 'qué bueno', 'nice', 2],
      ['Caro', 'tengo 20 minutos', 'I have 20 minutes'],
      ['Nico', 'contame todo', 'tell me everything'],
      ['Caro', 'mi jefa cambió todo otra vez', 'my boss changed everything again', 2],
      ['Vale', 'uf, qué bajón', 'ugh, so annoying'],
      ['Caro', 'ya sé, ya sé', 'I know, I know', 2],
      ['Nico', 'aguantá, el finde nos vemos', 'hang in there, see you this weekend'],
      ['Caro', 'dale 🙏', 'ok 🙏', 2],
    ],
  },
  {
    lines: [
      ['Vale', '¿pizza o empanadas?', 'pizza or tacos?'],
      ['Nico', 'pizza', 'pizza'],
      ['Fran', 'empanadas', 'tacos'],
      ['Caro', 'las dos', 'both'],
      ['Vale', 'gana Caro', 'Caro wins'],
    ],
  },
  {
    // Nico arma el plan del finde y Caro vota la película horas después.
    hour: 18,
    lines: [
      ['Nico', '¿qué hacemos el finde? ¿salimos?', 'what are we doing this weekend? wanna go out?'],
      ['Vale', 'cine y después cenamos', 'movies and then dinner'],
      ['Fran', 'yo voto la de terror!!', 'I vote for the horror one!!'],
      ['Nico', 'Caro, ¿vos qué querés ver?', 'Caro, what do you want to watch?'],
      ['Caro', 'la de comedia', 'the comedy'],
      ['Caro', 'terror no, por favor', 'no horror, please'],
      ['Fran', 'cobarde', 'coward'],
      ['Nico', 'comedia entonces, el sábado', 'comedy then, saturday'],
      ['Vale', '🍿'],
    ],
  },
  {
    silenceBefore: 5,
    lines: [
      ['Nico', '¿y si nos vamos a la costa en febrero?', 'what if we go to the beach in february?'],
      ['Vale', 'SÍ', 'YES'],
      ['Fran', 'yo me prendo', "I'm in"],
      ['Caro', 'tengo que ver si me dan días', 'need to check if I can get days off'],
      ['Nico', 'https://www.airbnb.com/rooms/vistazo-demo'],
      ['Vale', 'esa casa es un sueño', 'that house is a dream'],
      ['Nico', '🙌'],
    ],
  },
  {
    lines: [
      ['Fran', 'el chico del bar me escribió', 'the guy from the bar texted me'],
      ['Vale', '¿¿y??', 'and??'],
      ['Fran', 'me dijo que anoche estaba muy sexy 🙈', 'said I looked really hot last night 🙈'],
      ['Caro', 'ese sí sabe', "he's got taste"],
      ['Fran', 'ay 🙈', 'oh 🙈'],
    ],
  },
  {
    // Caro, que casi nunca arranca, trae un video: el único cierre de la escena es ella misma.
    hour: 21,
    lines: [
      ['Caro', MEDIA],
      ['Caro', 'miren lo que me mandaron', 'look what I was sent'],
      ['Fran', 'JAJAJAJA ES IGUAL A VOS', "HAHAHA IT'S EXACTLY YOU"],
      ['Nico', 'mandalo de nuevo, no se ve', "send it again, it won't play"],
      ['Caro', MEDIA, undefined, 6],
      ['Vale', 'me morí 😂', 'I died 😂'],
      ['Caro', 'jaja', 'haha', 3],
    ],
  },
  {
    lines: [
      ['Fran', 'perdí las llaves', 'lost my keys'],
      ['Fran', 'busqué por toda la casa', 'searched the whole house'],
      ['Fran', 'llamé al cerrajero', 'called a locksmith'],
      ['Fran', 'estaban en mi bolsillo', 'they were in my pocket'],
      ['Fran', 'no quiero hablar del tema', "I don't want to talk about it"],
      ['Vale', 'JAJAJAJA', 'HAHAHAHA'],
    ],
  },
  {
    hour: 23,
    lines: [
      ['Vale', 'mi ex me escribió', 'my ex texted me'],
      ['Fran', 'NO. BLOQUEO INMEDIATO', 'NO. BLOCK IMMEDIATELY'],
      ['Caro', '¿qué te dijo?', 'what did he say?'],
      ['Vale', "'hola, cómo andás'", "'hey, how are you'"],
      ['Nico', 'clásico ex a las 11 de la noche', 'classic 11pm ex'],
      ['Vale', 'no le contesté 💪', "didn't answer 💪"],
      ['Fran', 'orgullosa 🙌', 'proud 🙌'],
    ],
  },
  {
    // Caro, la que menos habla, abre su casa: la que más cuesta de leer como "tímida".
    hour: 20,
    lines: [
      ['Caro', 'chicos, ¿se vienen a casa el sábado?', 'guys, want to come over on saturday?'],
      ['Vale', '¡sí!', 'yes!'],
      ['Fran', 'LLEVO EL FERNET', "I'M BRINGING THE DRINKS"],
      ['Nico', 'nos vemos a las 9', 'see you at 9'],
      ['Caro', 'hago pizza', "I'll make pizza"],
      ['Caro', 'no traigan nada', "don't bring anything"],
      ['Fran', 'MENTIRA, LLEVO IGUAL', "LIAR, I'M BRINGING IT ANYWAY"],
      ['Vale', '❤️'],
    ],
  },
  {
    lines: [
      ['Caro', LONG_THANKS_ES, LONG_THANKS_EN],
      ['Fran', 'BASTA, ME HICISTE LLORAR', "STOP, I'M CRYING"],
      ['Vale', 'los amo 😭❤️', 'love you guys 😭❤️'],
      ['Nico', 'igual Fran escucha los audios a 2x', 'Fran listens to voice notes at 2x though'],
      ['Fran', 'mentira 😤', 'lies 😤'],
    ],
  },
  {
    lines: [
      ['Caro', 'llegué a casa 🙌', 'home safe 🙌'],
      ['Vale', '❤️'],
      ['Fran', '🙌🙌'],
      ['Nico', 'descansá 😴', 'rest up 😴'],
    ],
  },
]

/** PRNG de 32 bits con semilla fija: mismo chat en cada carga, en cada máquina. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLine(date: Date, sender: Person, text: string): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())} - ${sender}: ${text}`
}

function lineText([, text, english]: Line, language: Language): string {
  if (typeof text !== 'string') {
    return text[language]
  }
  // Los links y los emojis sueltos son iguales en los dos idiomas.
  return language === 'en' && english !== undefined ? english : text
}

export function landingSampleChatName(language: Language): string {
  return language === 'es' ? 'Los de siempre' : 'The usual crew'
}

export function buildLandingSampleChat(language: Language): string {
  const random = mulberry32(20250301)
  const between = ([min, max]: [number, number]) => Math.round(min + random() * (max - min))
  const lines: string[] = []
  const day = new Date(2025, 2, 3)

  for (const scene of SCENES) {
    // Entre escena y escena pasan uno o dos días: el chat se lee como semanas de un
    // grupo real, no como una sola noche.
    day.setDate(day.getDate() + 1 + (random() < 0.15 ? 1 : 0) + (scene.silenceBefore ?? 0))

    const clock = new Date(day)
    const hour = scene.hour ?? SESSION_HOURS[Math.floor(random() * SESSION_HOURS.length)]
    clock.setHours(hour, Math.floor(random() * 50), 0, 0)

    let previous: Person | null = null
    for (const line of scene.lines) {
      const [speaker, , , minutesSincePrevious] = line
      if (previous !== null) {
        // La misma persona escribe de corrido; si cambia, tarda lo que se le indicó o lo
        // que tarda ella.
        const wait =
          speaker === previous
            ? random() < 0.7
              ? 0
              : 1
            : (minutesSincePrevious ?? between(REPLY_MINUTES[speaker]))
        clock.setMinutes(clock.getMinutes() + wait)
      }
      lines.push(formatLine(clock, speaker, lineText(line, language)))
      previous = speaker
    }
  }

  return lines.join('\n')
}
