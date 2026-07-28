# Documento de Requisitos y Alcance (PRD)

**Proyecto:** Aplicación Web "WhatsApp Chat Wrapped" (nombre de marca por definir — ver sección 7)
**Líder de Proyecto:** Santiago Nuñez Selem
**Inspiración funcional:** ver `06_Referencia_Competencia_The_Cringe.md`

## 1. Visión del Proyecto
Desarrollar una aplicación web Freemium que permita a los usuarios subir un historial de chat de WhatsApp (formato `.txt` o `.zip`) y obtener un análisis estadístico dinámico y divertido de su conversación. La interfaz debe imitar el estilo de "Spotify Wrapped" o "Instagram Stories". El enfoque principal es garantizar la privacidad del usuario procesando los mensajes localmente en el navegador (nunca se envía el texto crudo de la conversación a un servidor), minimizando así los costos de infraestructura.

El tono general del producto es divertido y lúdico, con una sección específica más "picante" orientada a detectar patrones de tensión ("red flags") en la relación/chat — inspirada en el posicionamiento de "The Cringe", pero sin que sea el eje central de toda la marca.

## 2. Idiomas
La aplicación debe soportar **español e inglés desde el MVP** (selector de idioma o detección automática por navegador/ubicación). Todos los textos de UI, nombres de métricas, mensajes de carga y reportes deben estar internacionalizados (i18n) desde el inicio del desarrollo, no como un agregado posterior.

## 3. Modelo Freemium y Funcionalidades

## 3.1. Regla Global de Interfaz (Botón "Más Detalles")
Todas las estadísticas (tanto gratuitas como premium) deben incluir un botón de "Más Detalles" visible para todos los usuarios. Al hacer clic, se abrirá un modal o vista expandida que mostrará el nombre de la estadística, los datos generales (ya visibles) y un desglose exhaustivo para **todos los integrantes del chat** (soportando chats grupales de múltiples personas). 

*   **Para usuarios con versión PRO:** La vista detallada se muestra completamente nítida e interactiva.
*   **Para usuarios con versión Gratuita:** La información de la vista detallada debe renderizarse en el DOM, pero cubierta con un efecto visual de *blur* y un *Call to Action* (CTA) superpuesto invitando a suscribirse para desbloquear los datos.

### 3.2. Versión Gratuita (Procesamiento 100% Client-Side)
Todas estas métricas deben calcularse mediante algoritmos en el frontend (Javascript/React) sin llamadas a APIs externas:
*   **El Monologuista:** 
    *   *Vista Básica:* Muestra a la persona con la mayor racha de mensajes consecutivos enviados sin recibir respuesta.
    *   *Vista Detallada (PRO Blur):* Un ranking por cada integrante del grupo mostrando sus rachas de mensajes consecutivos. Incluye paginación: muestra los primeros 10 bloques de mensajes literales de cada integrante, con un botón de "Mostrar más" que carga de a 10 adicionales (hasta un límite de 100).
*   **El Reloj Biológico:** 
    *   *Vista Básica:* Gráfico simple que define la personalidad del chat ("Búhos" vs "Madrugadores") basado en picos de horarios.
    *   *Vista Detallada (PRO Blur):* Un calendario interactivo y detallado (Heatmap horario) desglosado por cada integrante, permitiendo ver exactamente a qué horas del día es más activo cada participante de forma individual.
*   **El Rompehielo:** 
    *   *Vista Básica:* El integrante que inicia la conversación más veces al comenzar un nuevo día.
    *   *Vista Detallada (PRO Blur):* Gráfico de torta con porcentajes de "inicios de día" por participante, acompañado de una lista scrolleable con los primeros mensajes exactos que se enviaron en cada fecha.
*   **Guerra de Emojis:** 
    *   *Vista Básica:* Un podio general con los 5 emojis más utilizados en todo el chat.
    *   *Vista Detallada (PRO Blur):* El "Top 20" de emojis exclusivo de cada participante, junto con un contador exacto de cuántas veces usó cada uno.
*   **Días de Racha:** 
    *   *Vista Básica:* Número que indica la máxima cantidad de días consecutivos enviando al menos un mensaje.
    *   *Vista Detallada (PRO Blur):* Un calendario mensual completo resaltando todas las rachas históricas mayores a 3 días, y un desglose del porcentaje de participación de cada integrante dentro de esas rachas.
*   **El Testamento:** 
    *   *Vista Básica:* El mensaje individual con mayor cantidad de caracteres de todo el chat.
    *   *Vista Detallada (PRO Blur):* Un "Top 10" de los mensajes más largos enviados por *cada uno* de los integrantes, con su respectivo conteo de palabras y caracteres (paginado).
*   **El Spammer vs El Silencioso:** 
    *   *Vista Básica:* Gráfico de barras simple con el porcentaje total de mensajes enviados por cada integrante.
    *   *Vista Detallada (PRO Blur):* Gráfico de líneas (Timeline) que muestra la evolución mes a mes del volumen de mensajes enviados por cada participante a lo largo de la historia del chat.
*   **Heatmap Anual:** 
    *   *Vista Básica:* Gráfico de calor (estilo contribuciones de GitHub) mostrando los días de mayor actividad general en el año.
    *   *Vista Detallada (PRO Blur):* Heatmaps individuales y superponibles por cada participante, permitiendo comparar visualmente quién lideró la conversación en diferentes épocas del año.
*   **El Mes Más Intenso / Top 10 Días:** 
    *   *Vista Básica:* El mes o día con el pico histórico absoluto de mensajes.
    *   *Vista Detallada (PRO Blur):* El desglose de quién envió cuántos mensajes en esos 10 días pico, mostrando fragmentos de la conversación que provocaron esa explosión de actividad.
*   **Termómetro Semanal:** 
    *   *Vista Básica:* Gráfico radial (Spider plot) de la distribución de mensajes según el día de la semana.
    *   *Vista Detallada (PRO Blur):* Gráficos radiales individuales para cada integrante, cruzando los días de la semana con las franjas horarias (mañana, tarde, noche).
*   **El Fan de la Multimedia:** 
    *   *Vista Básica:* Quién envía más archivos adjuntos (leyendo etiquetas como `<Media omitted>`).
    *   *Vista Detallada (PRO Blur):* Línea de tiempo que marca los días donde cada participante hizo "spam" de archivos multimedia, detallando la cantidad exacta por usuario.
*   **El Velocista:** 
    *   *Vista Básica:* Promedio más bajo de palabras por mensaje.
    *   *Vista Detallada (PRO Blur):* Un histograma detallado para cada integrante que clasifique sus mensajes en categorías (ej: "Cortos: 1-3 palabras", "Medios: 4-10 palabras", "Largos: +11 palabras").

### 3.3. Versión PRO (Funciones Premium, requieren suscripción activa)
Estas métricas se desbloquean con una suscripción activa (ver `05_Monetizacion_y_Suscripciones.md` para el modelo de negocio). Algunas requieren backend o APIs de IA. Estas IAs o el backend tiene que ser sin costo. Buscar si es necesario IAs para realizar queris o consultas sin costo. Debo tener cuidado con si tienen consultas infinitas o como se puede hacer para no quedarme sin consultas.
Por ello siempre intentar llevar a cabo las funcionalidades de cada estadistica sin IA. Si alguna necesita si o si IA aun asi implementar un metodo para hacerlo sin IA por si la IA falla:
*   **El Clavavistos:** 
    *   *Vista Básica:* Tiempo promedio de respuesta en minutos y el "Top 1" de la peor demora. Aca se debe considerar que lo mensajes esperen respuesta, como una pregunta, o un inicio de conversacion. No cuentan mensajes que no esperan ser respondidos.
    *   *Vista Detallada:* Historial completo (paginado hasta 100 eventos) de los peores tiempos de respuesta por cada participante, mostrando fecha, hora y el mensaje exacto que fue ignorado.
*   **Rachas de Inactividad:** 
    *   *Vista Básica:* El periodo más largo de tiempo sin cruzar un solo mensaje.
    *   *Vista Detallada:* Lista cronológica de todos los "silencios" mayores a 48hs en la historia del chat, indicando exactamente qué participante rompió el hielo en cada ocasión.
*   **Análisis de Sentimiento (Radar de Vibras):** 
    *   *Vista Básica:* Clasificación general de la charla (Romántica, Caótica, Tensa, Amistosa).
    *   *Vista Detallada:* Gráfico de evolución del sentimiento a lo largo del tiempo, y un "Score de Vibra" individual que analice si un participante es estadísticamente más "positivo" o "negativo" que los demás.
*   **Nube de Palabras Avanzada:** 
    *   *Vista Básica:* Wordcloud visual excluyendo artículos, preposiciones y conectores comunes.
    *   *Vista Detallada:* Nubes de palabras exclusivas para cada integrante y un buscador que permite ingresar una palabra para ver exactamente cuántas veces la dijo cada uno.
*   **El Lector de Mentes:** 
    *   *Vista Básica:* Agrupación temática principal de la conversación.
    *   *Vista Detallada:* Desglose de qué participante es el que más inicia cada tema específico (ej. quién saca más el tema "trabajo" vs quién saca más el tema "estudio").
*   **Detector de Red Flags:** 
    *   *Vista Básica:* Puntuación general de "tensión" o desequilibrio conversacional.
    *   *Vista Detallada:* Sección inspirada en *The Cringe*. Identificación de patrones repetitivos en discusiones, desequilibrios marcados en tiempos de respuesta o esfuerzo conversacional, y frecuencia de ciertas palabras clave configurables (celos, disculpas, reclamos) por cada integrante.
*   **Índice de "Cringe":** 
    *   *Vista Básica:* Frecuencia de uso de vocabulario predefinido como anticuado, vergonzoso o "cringe" (lista de palabras/frases configurable).
    *   *Vista Detallada:* El "Top 5 Momentos Cringe" de cada participante, citando textualmente la frase, el contexto y la fecha exacta en la que se envió.
*   **El Tono Picante (+18):** 
    *   *Vista Básica:* Quién mandó más mensajes clasificados como "subidos de tono" o explícitos (usando un diccionario predefinido de palabras clave o un modelo de IA ligero).
    *   *Vista Detallada:* Un desglose de los horarios preferidos por el grupo para este tipo de mensajes, y un "Top 5" de los días más ardientes de cada participante, citando (si el usuario lo permite) las palabras más usadas en ese contexto.
*   **El Curador de Contenidos (Links y Redes):** 
    *   *Vista Básica:* Quién comparte la mayor cantidad de enlaces externos (TikToks, Reels, noticias, YouTube).
    *   *Vista Detallada:* Categorización de los links enviados por cada integrante (qué porcentaje son de música, qué porcentaje de videos graciosos) y una tasa de "éxito": a qué participante le ignoran menos los links que manda.
*   **El Arrepentido (Mensajes Eliminados):** 
    *   *Vista Básica:* Conteo total de cuántos mensajes borró cada persona en la historia del chat (detectando la etiqueta del sistema "Se eliminó este mensaje"/"This message was deleted"/"You deleted this message"). Buscar como se identifican los mensajes eliminados en los chats de ejemplo en esta carpeta.
    *   *Vista Detallada:* Un gráfico de línea de tiempo mostrando en qué meses o días de la semana ocurren más "arrepentimientos" por cada integrante, y un cálculo de quién suele borrar mensajes en medio de la madrugada vs. a plena luz del día.
*   **El Políglota (Detector de Spanglish):** 
    *   *Vista Básica:* Quién mezcla más idiomas o usa más términos en inglés u otros idiomas durante la conversación cotidiana.
    *   *Vista Detallada:* Un gráfico de torta por cada participante mostrando la proporción de anglicismos o palabras extranjeras detectadas, junto con un ranking personal de sus términos importados favoritos (ej. "bro", "random", "match").
*   **El Viajero del Tiempo:** 
    *   *Vista Básica:* Quién es el que más responde a mensajes muy viejos usando la función nativa de "Responder" (citando mensajes de días o semanas anteriores).
    *   *Vista Detallada:* El récord personal de cada integrante del mensaje más antiguo al que decidieron responder de la nada, mostrando la cita exacta y calculando la brecha de tiempo (en días o meses) entre el envío original y la repentina respuesta.
**El "Jajaja" Analítico (Medidor de Risas):** 
    *   *Vista Básica:* Quién se ríe más en el chat y cuál es su estilo de risa predominante ("jaja", "jeje", "JAJAJA", "jsjsjs" o "lol").
    *   *Vista Detallada:* Gráfico de barras por cada integrante mostrando la distribución exacta de sus tipos de risa. Identifica quién da la temida "risa seca" (un simple "ja") y quién es el que pierde el control del teclado ("ajskdhasjd").
*   **El Metralleta (Ansiedad de Micro-mensajes):** 
    *   *Vista Básica:* Quién tiene la costumbre de fragmentar una sola oración en 15 mensajes diferentes de una o dos palabras.
    *   *Vista Detallada:* El ranking de cada participante del "combo" más grande de mensajes consecutivos enviados en un lapso de 10 segundos, mostrando el bloque literal de chat que demuestra la metralleta de notificaciones.
*   **El Interrogador (Modo Entrevista):** 
    *   *Vista Básica:* Quién hace más preguntas en la conversación (contando los signos de interrogación `?`) en contraste con quién da las respuestas.
    *   *Vista Detallada:* Un radar de curiosidad por cada integrante. Calcula la proporción de preguntas que hacen e identifica quién es el que deja más preguntas ajenas "en el aire" sin responder jamás.
*   **El Dramático (Medidor de Mayúsculas):** 
    *   *Vista Básica:* Quién es el que más "Grita" en el chat, calculando qué porcentaje de sus mensajes son enviados completamente en MAYÚSCULAS.
    *   *Vista Detallada:* El "Top 3 de berrinches o euforia" por cada integrante, exponiendo los mensajes más largos escritos íntegramente en mayúsculas y la fecha exacta en la que perdieron la compostura.
*   **Exportación HD:** 
    *   Generación de un PDF o imágenes en alta resolución de las estadísticas (sin marca de agua). *(Esta función es global y no aplica la lógica de "Vista Detallada").*

### 3.4. Trial gratuito (no confundir con la versión gratuita)
Además de las métricas gratuitas permanentes (sección 3.1), el usuario puede activar un **trial de 1 semana con acceso completo a las métricas PRO**, sujeto a las reglas definidas en `05_Monetizacion_y_Suscripciones.md` (requiere método de pago cargado; se cobra automáticamente al finalizar la semana salvo cancelación).

## 4. Fuente de datos y alcance del parser
*   **Formato soportado:** únicamente el archivo de exportación nativo de WhatsApp (`.txt` dentro de un `.zip`, o `.txt` suelto).
*   **Fuera de alcance:** carga de capturas de pantalla (OCR) de WhatsApp u otras apps de mensajería (iMessage, Instagram, Snapchat). Esto es una diferencia intencional respecto a la app de referencia (The Cringe) y podría evaluarse como fase futura, pero no debe implementarse en el MVP.
*   El detalle del formato y parsing está en `03_Procesamiento_Datos_y_Regex.md`.

## 5. Cuentas de usuario y privacidad
*   Login obligatorio mediante Google OAuth 2.0 para poder subir y analizar un chat.
*   Los mensajes crudos del chat **nunca** se envían ni almacenan en el backend; solo se procesan en el navegador del usuario.
*   Únicamente el JSON de resultados agregados (métricas calculadas) se envía al backend y se guarda asociado a la cuenta del usuario, permitiendo ver un historial de análisis pasados.
*   Esto debe comunicarse claramente en la landing y en el flujo de upload, ya que es un diferencial de confianza frente a apps que procesan todo "en una caja negra".

## 6. El blureo de informacion (ocultar informacion)
*   Cuando se desarrolle el modo para ocultar informacion, se debe tener en cuenta el desarrollo de forma tal que el mismo no sea simplemente un estilo (css). Esto para evitar que se modifique el CSS desde el devtools y que el usuario pueda ver la informacion. El blureo de infomracion debe ser imposible de sacar a nivel de estilos y de HTML, de forma tal de que el usuario jamas pueda ver el contendio tapado si es que no tiene permiso ya que no tiene la version VIP.


## 7. Fuera de alcance
*   Soporte para otras apps de mensajería (Instagram, iMessage, Telegram, etc.) más allá de WhatsApp.
*   OCR de capturas de pantalla.
*   Apps móviles nativas (iOS/Android). El producto es exclusivamente web.
*   Chats grupales con más de 2 participantes (a definir si se soporta en una fase posterior; el MVP asume chats 1 a 1, salvo que se indique lo contrario en una iteración futura del análisis).

## 8. Branding
El nombre de marca, logo, paleta definitiva y tono de copywriting quedan a definición de quien desarrolle el proyecto (posiblemente asistido por IA), siempre respetando la línea de tono descripta en la sección 1 y en `04_UI_UX_Diseño.md`. No debe reutilizarse el nombre "The Cringe" ni ningún elemento de marca de la app de referencia.
