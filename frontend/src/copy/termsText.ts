/**
 * Los Términos y Condiciones de Vistazo, con la Política de Privacidad adentro.
 *
 * Es la edición `TERMS_VERSION` (lib/terms.ts). Cambiar una coma de acá sin cambiar esa
 * fecha deja a todas las cuentas con una aceptación que no corresponde al texto que se ve;
 * cambiarla hace que cada cuenta los vuelva a aceptar una vez.
 *
 * Sólo en español: es la versión que rige, y una traducción es una segunda versión que
 * puede contradecir a la primera.
 *
 * Vive aparte del resto del copy porque sólo lo cargan el cartel y la página de términos,
 * que se bajan por separado (lazyPanel): un usuario que ya los aceptó nunca descarga esto.
 */

/**
 * Quién presta el servicio.
 *
 * Nada es obligatorio. El canal de contacto de los términos es la página de ayuda de la
 * aplicación, no un mail: así no hay ninguna dirección personal publicada. `name` y `cuit`
 * son opcionales: vacíos, el texto no los menciona y dice que los datos de identificación se
 * informan a las autoridades y a quien acredite un interés legítimo. Nunca va un domicilio
 * particular. Qué se gana y qué se arriesga al dejarlos vacíos está en "Términos y
 * condiciones" del README.
 */
export const TERMS_OWNER: { name: string; cuit: string } = {
  name: '',
  cuit: '',
}

/** "Nombre Apellido, CUIT 20-…" con lo que haya; vacío si no se publicó ningún dato. */
const ownerIdentity = [TERMS_OWNER.name.trim(), TERMS_OWNER.cuit.trim() ? `CUIT ${TERMS_OWNER.cuit.trim()}` : '']
  .filter(Boolean)
  .join(', ')

/** Un párrafo, o una lista cuando el bloque es un arreglo. */
export type TermsBlock = string | readonly string[]

export interface TermsSection {
  title: string
  blocks: readonly TermsBlock[]
}

export const TERMS_SECTIONS: readonly TermsSection[] = [
  {
    title: '1. Quién presta el servicio',
    blocks: [
      ownerIdentity
        ? `Vistazo (en adelante, "Vistazo", "nosotros" o "el Servicio") es un servicio prestado por ${ownerIdentity}, persona humana con domicilio en la República Argentina (en adelante, "el Titular").`
        : 'Vistazo (en adelante, "Vistazo", "nosotros" o "el Servicio") es un servicio operado desde la República Argentina por su titular (en adelante, "el Titular"). Los datos de identificación del Titular están a disposición de las autoridades competentes y de quien acredite un interés legítimo, y se informan a través de los canales de contacto indicados a continuación.',
      'Para cualquier consulta, reclamo o notificación vinculada con estos términos, el Usuario puede escribir desde la página de ayuda de la aplicación (la sección "¿Tuviste algún problema?", al pie de la pantalla de suscripción), completando el formulario con el correo en el que desea recibir la respuesta. Ese canal funciona como domicilio electrónico del Titular a todos los efectos de estos términos.',
    ],
  },
  {
    title: '2. Aceptación',
    blocks: [
      'Estos Términos y Condiciones (los "Términos") regulan el uso de Vistazo por parte de cualquier persona que inicie sesión en el Servicio (el "Usuario"). Incluyen la Política de Privacidad de la sección 16.',
      'Al marcar la casilla de aceptación y presionar "Aceptar y continuar", el Usuario declara haberlos leído, entendido y aceptado en su totalidad. Si no está de acuerdo, no debe usar su cuenta: puede cerrar la sesión y, si lo desea, pedir la eliminación de sus datos.',
      'La aceptación queda registrada con la fecha y la edición de los Términos que se aceptó.',
    ],
  },
  {
    title: '3. Qué es Vistazo',
    blocks: [
      'Vistazo es una herramienta de entretenimiento que genera estadísticas y resúmenes (métricas, gráficos y recorridos tipo "Wrapped") a partir del archivo de exportación de un chat de WhatsApp que el propio Usuario elige cargar.',
      'El archivo se procesa en el navegador del dispositivo del Usuario. El chat completo nunca se envía a nuestros servidores. Lo que sí se guarda en la cuenta, y con qué alcance, se detalla en la Política de Privacidad (sección 16).',
      'Vistazo no está afiliado, asociado, autorizado ni respaldado por WhatsApp ni por Meta Platforms, Inc. "WhatsApp" es una marca de sus respectivos titulares y se menciona sólo para describir el formato de archivo que el Servicio lee.',
    ],
  },
  {
    title: '4. Cuenta y requisitos',
    blocks: [
      'Para usar Vistazo con una cuenta hay que iniciar sesión con Google. El Usuario declara:',
      [
        'ser mayor de 18 años y tener capacidad legal para contratar;',
        'que los datos de su cuenta son verdaderos y le pertenecen;',
        'que la cuenta es personal: no la va a compartir, ceder ni vender, y es responsable de todo lo que se haga desde ella.',
      ],
      'El Usuario debe avisarnos de inmediato si sospecha que un tercero accedió a su cuenta. Vistazo no se responsabiliza por accesos que resulten de la falta de cuidado del Usuario con su cuenta de Google o con sus dispositivos.',
    ],
  },
  {
    title: '5. Los chats que se cargan y los datos de terceros',
    blocks: [
      'Un chat contiene mensajes, nombres y datos de otras personas además del Usuario. Al cargar un chat, el Usuario declara y garantiza que:',
      [
        'participa de esa conversación o tiene derecho legítimo a acceder a ella y a analizarla;',
        'va a usar los resultados para fines personales y lícitos, y no para acosar, extorsionar, discriminar, exponer o perjudicar a otra persona;',
        'si comparte resultados que identifican a otras personas, cuenta con su conformidad o con otra base legal que lo permita.',
      ],
      'El Usuario es el único responsable por el contenido que carga y por el uso que hace de los resultados. Vistazo no revisa ni controla el contenido de los chats y no asume responsabilidad frente al Usuario ni frente a terceros por ese contenido ni por su uso.',
    ],
  },
  {
    title: '6. Plan gratuito y Plan Pro',
    blocks: [
      'Vistazo ofrece funciones sin costo y un plan pago por suscripción ("Pro") que habilita métricas adicionales. Qué incluye cada plan se muestra en la aplicación y puede cambiar con el tiempo.',
      'Condiciones del Plan Pro:',
      [
        'Precio: el que se informa en la pantalla de suscripción al momento de contratar, en pesos argentinos y con los impuestos que correspondan.',
        'Prueba gratis: la primera suscripción puede incluir un período de prueba sin cargo. Es una sola por persona. Para prevenir abusos se usan señales técnicas (cuenta, red, dispositivo y país), y Vistazo puede no ofrecer la prueba, o dejarla sin efecto, cuando detecte que ya fue usada o que se intenta obtener más de una.',
        'Renovación automática: al terminar la prueba, y luego cada mes, la suscripción se cobra automáticamente con el medio de pago elegido, hasta que el Usuario la cancele.',
        'Medio de pago: los cobros los procesa Mercado Pago, bajo sus propios términos. Vistazo nunca recibe ni guarda los datos completos de tarjetas.',
        'Cancelación: el Usuario puede cancelar en cualquier momento desde la pantalla de suscripción, con la misma facilidad con la que se suscribió. Al cancelar no se realizan más cobros y el acceso Pro se mantiene hasta el fin del período ya pagado. Si cancela durante la prueba gratis, no se le cobra nada.',
        'Reembolsos: no se reintegran períodos parcialmente usados ni meses ya cobrados, salvo en los casos en que la ley lo exija.',
        'Pagos rechazados: si un cobro no puede realizarse, Vistazo puede suspender el acceso Pro hasta que se regularice.',
        'Cambios de precio: Vistazo puede modificar el precio del Plan Pro. Los cambios se avisan con al menos 30 días de anticipación y se aplican desde la renovación siguiente; quien no esté de acuerdo puede cancelar antes sin costo.',
      ],
      'Derecho de revocación: tratándose de una contratación a distancia, el Usuario consumidor puede revocar la aceptación dentro de los 10 días corridos desde que contrató, sin costo ni responsabilidad, conforme al artículo 34 de la Ley 24.240 de Defensa del Consumidor. Para ejercerlo alcanza con pedirlo desde la página de ayuda. Este derecho no se puede renunciar y nada de estos Términos lo limita.',
    ],
  },
  {
    title: '7. Métricas con inteligencia artificial',
    blocks: [
      'Algunas métricas Pro usan un servicio de inteligencia artificial de Google (Gemini) para revisar mensajes que un filtro de palabras ya marcó. Sólo se usan si el Usuario da su consentimiento expreso dentro de la aplicación, que se pide una única vez.',
      'Con ese consentimiento se envían únicamente fragmentos breves de los mensajes marcados, con los nombres reemplazados por letras. El resto del chat no sale del dispositivo. El Usuario puede no darlo: en ese caso esas métricas no se calculan con IA.',
      'Los resultados generados con IA son automáticos y pueden contener errores, omisiones o interpretaciones equivocadas.',
    ],
  },
  {
    title: '8. Naturaleza de los resultados',
    blocks: [
      'Vistazo es un servicio de entretenimiento. Las métricas, los textos y las etiquetas (por ejemplo, "red flags" o "tono picante") se generan de forma automática a partir de patrones de texto y tienen un tono deliberadamente humorístico.',
      'Los resultados son aproximados, pueden ser incorrectos o incompletos, y dependen del formato y la calidad del archivo exportado. No constituyen un diagnóstico ni un asesoramiento psicológico, médico, legal ni profesional de ningún tipo, y no describen de manera objetiva a ninguna persona ni a ninguna relación.',
      'El Usuario se compromete a no tomar decisiones relevantes sobre su vida, su salud o sus relaciones sobre la base de los resultados de Vistazo. Vistazo no se responsabiliza por las consecuencias de esas decisiones.',
    ],
  },
  {
    title: '9. Links compartidos',
    blocks: [
      'El Usuario puede generar un link para compartir un recorrido de resultados. Ese link es público: cualquier persona que lo tenga puede verlo, sin iniciar sesión. Los links vencen a los 90 días.',
      'Antes de publicarlo se quita el texto literal de los mensajes, pero el recorrido puede incluir nombres de participantes, cifras y etiquetas que permitan identificar a personas. El Usuario decide qué comparte y con quién, y es el único responsable de hacerlo.',
    ],
  },
  {
    title: '10. Usos prohibidos',
    blocks: [
      'El Usuario se compromete a no:',
      [
        'usar Vistazo para fines ilícitos o para dañar, acosar, amenazar, extorsionar o exponer a otras personas;',
        'cargar chats a los que no tiene derecho a acceder;',
        'crear varias cuentas o usar cualquier otro medio para obtener más de una prueba gratis o eludir los límites del plan gratuito;',
        'automatizar el uso del Servicio, extraer sus datos de forma masiva o sobrecargar sus servidores;',
        'copiar, descompilar, aplicar ingeniería inversa o intentar acceder al código, las claves o los datos de otros usuarios, o vulnerar las medidas de seguridad;',
        'revender, sublicenciar o explotar comercialmente el Servicio o sus resultados sin autorización escrita.',
      ],
    ],
  },
  {
    title: '11. Propiedad intelectual',
    blocks: [
      'La aplicación, su código, su diseño, su nombre, sus marcas, sus métricas y sus textos son propiedad del Titular o de sus licenciantes, y están protegidos por la legislación vigente. El uso de Vistazo no le otorga al Usuario ningún derecho sobre ellos, más allá de la licencia personal, limitada, revocable e intransferible de usarlo conforme a estos Términos.',
      'El contenido de los chats sigue siendo de quienes lo escribieron. Vistazo no adquiere ningún derecho sobre él.',
    ],
  },
  {
    title: '12. Disponibilidad y cambios del Servicio',
    blocks: [
      'Vistazo se ofrece "tal como está" y "según disponibilidad". Hacemos lo posible para que funcione bien y de forma continua, pero no garantizamos que esté libre de errores, interrupciones o demoras, ni que sea compatible con todos los dispositivos, navegadores o formatos de exportación.',
      'Podemos agregar, modificar o quitar funciones, hacer mantenimiento y cambiar los límites del plan gratuito. Si se discontinuara el Plan Pro en su totalidad, se avisará con anticipación y se reintegrará la parte proporcional de lo pagado por el período que quede sin usar.',
    ],
  },
  {
    title: '13. Suspensión y baja',
    blocks: [
      'Vistazo puede suspender o dar de baja una cuenta, sin derecho a reintegro de lo ya consumido, cuando el Usuario incumpla estos Términos, cuando haya indicios razonables de fraude, abuso o uso ilícito, o cuando lo ordene una autoridad competente. Siempre que sea posible y no lo impida la ley o la seguridad del Servicio, se le informará el motivo.',
      'El Usuario puede dejar de usar Vistazo cuando quiera y pedir la eliminación de su cuenta y de sus datos desde la página de ayuda. Si tiene una suscripción activa, debe cancelarla antes para que no se generen nuevos cobros.',
    ],
  },
  {
    title: '14. Limitación de responsabilidad',
    blocks: [
      'En la máxima medida permitida por la ley aplicable:',
      [
        'Vistazo no será responsable por daños indirectos, lucro cesante, pérdida de oportunidades, daño moral o perjuicios derivados del contenido de los chats, de los resultados del análisis, de lo que el Usuario decida compartir o de las decisiones que tome sobre la base de esos resultados;',
        'Vistazo no será responsable por fallas, demoras o decisiones de servicios de terceros (como Google, WhatsApp, Mercado Pago o los proveedores de infraestructura), ni por interrupciones causadas por caso fortuito o fuerza mayor;',
        'la responsabilidad total de Vistazo frente al Usuario por cualquier concepto no excederá el monto que el Usuario haya pagado a Vistazo en los 12 meses anteriores al hecho que la origine.',
      ],
      'Nada de lo anterior limita los derechos que la Ley 24.240 de Defensa del Consumidor le reconoce al Usuario y que no pueden renunciarse, ni la responsabilidad que no puede excluirse por ley.',
    ],
  },
  {
    title: '15. Indemnidad',
    blocks: [
      'El Usuario se obliga a mantener indemne a Vistazo y al Titular frente a cualquier reclamo, sanción, daño o gasto (incluidos honorarios razonables de abogados) que se origine en el contenido que haya cargado, en lo que haya compartido, en el incumplimiento de estos Términos o en la violación de derechos de terceros.',
    ],
  },
  {
    title: '16. Política de Privacidad',
    blocks: [
      `El responsable del tratamiento de los datos personales es el Titular (sección 1). Los datos se tratan conforme a la Ley 25.326 de Protección de los Datos Personales y su normativa complementaria.`,
      'Qué datos guardamos:',
      [
        'De la cuenta: nombre, correo electrónico y foto de perfil que provee Google al iniciar sesión, idioma elegido y fecha de último ingreso.',
        'De los análisis que el Usuario guarda: los resultados (cifras, rankings y gráficos), que pueden incluir nombres de participantes y fragmentos breves de mensajes usados como ejemplo dentro de una métrica. El archivo del chat completo nunca se sube.',
        'De la suscripción: estado, fechas, montos, correo del pagador y tipo de medio de pago informados por Mercado Pago. No guardamos números de tarjeta.',
        'Para prevenir abusos de la prueba gratis: una huella irreversible (hash) de la dirección IP, de la red y de un identificador del dispositivo, y el país de conexión.',
        'Si el Usuario activa las métricas con IA: los fragmentos marcados que se envían a Google y el resultado, para no volver a procesarlos.',
        'Si el Usuario manda un reporte desde la página de ayuda: el correo de contacto que indique, la descripción, el navegador y el tamaño de pantalla.',
        'Los links compartidos: el recorrido publicado, sin el texto de los mensajes, hasta su vencimiento.',
      ],
      'Para qué los usamos: para prestar el Servicio y guardar el historial del Usuario, cobrar y administrar la suscripción, prevenir fraudes y abusos, responder consultas y reclamos, mantener la seguridad, mejorar el producto con estadísticas agregadas y cumplir obligaciones legales. No vendemos datos personales ni los usamos para publicidad de terceros.',
      'Con quién los compartimos: sólo con los proveedores que necesitamos para funcionar —Google (inicio de sesión, verificación reCAPTCHA y, con consentimiento, las métricas con IA), Mercado Pago (cobros) y los proveedores de alojamiento e infraestructura—, cada uno para su finalidad, y con autoridades cuando una norma o una orden lo exija. Algunos de esos proveedores pueden almacenar datos fuera de la Argentina; al aceptar estos Términos, el Usuario presta su consentimiento para esa transferencia, que se hace con proveedores que ofrecen niveles adecuados de protección.',
      'En el dispositivo: la aplicación guarda en el almacenamiento del navegador la sesión, preferencias y un identificador del dispositivo, necesarios para su funcionamiento.',
      'Cuánto tiempo: mientras la cuenta exista. Cuando el Usuario pide eliminarla, se borran sus datos, salvo los que la ley obligue a conservar (por ejemplo, registros de facturación) y las huellas antiabuso, que se conservan sólo para impedir que se repita la prueba gratis.',
      'Derechos del Usuario: puede solicitar el acceso, la rectificación, la actualización o la supresión de sus datos desde la página de ayuda. El acceso es gratuito a intervalos no inferiores a seis meses, salvo interés legítimo acreditado (artículo 14, inciso 3 de la Ley 25.326).',
      'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
    ],
  },
  {
    title: '17. Comunicaciones',
    blocks: [
      'El Usuario acepta que Vistazo le envíe comunicaciones relacionadas con su cuenta, su suscripción y cambios del Servicio o de estos Términos al correo de su cuenta o dentro de la aplicación. Esas comunicaciones se consideran válidas a todos los efectos.',
    ],
  },
  {
    title: '18. Cambios en estos Términos',
    blocks: [
      'Vistazo puede actualizar estos Términos. La fecha de la última actualización figura al principio. Cuando un cambio sea relevante, se le pedirá al Usuario que acepte la nueva versión la próxima vez que use su cuenta; quien no esté de acuerdo puede dejar de usar el Servicio y cancelar su suscripción sin costo.',
    ],
  },
  {
    title: '19. Ley aplicable y jurisdicción',
    blocks: [
      'Estos Términos se rigen por las leyes de la República Argentina. Ante cualquier controversia, las partes se someten a los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires, con renuncia a cualquier otro fuero o jurisdicción, salvo que la normativa de defensa del consumidor le otorgue al Usuario el derecho a litigar en otro lugar.',
      'Antes de iniciar cualquier reclamo, el Usuario se compromete a escribirnos para intentar resolverlo de buena fe.',
    ],
  },
  {
    title: '20. Disposiciones generales',
    blocks: [
      [
        'Si alguna cláusula fuera declarada inválida, el resto de los Términos seguirá vigente.',
        'Que Vistazo no ejerza un derecho en algún momento no implica que renuncie a él.',
        'Vistazo puede ceder su posición en estos Términos a un tercero que continúe prestando el Servicio, avisándolo al Usuario.',
        'Estos Términos son el acuerdo completo entre el Usuario y Vistazo sobre su objeto. La versión en español es la que rige.',
      ],
    ],
  },
]
