# Interfaz de Usuario, Experiencia y Flujo (UI/UX)

## 1. Estilo Visual y Tono
*   **Inspiración visual:** Spotify Wrapped, Instagram Stories.
*   **Vibra general:** Divertida, lúdica, colorida y dinámica. No es una herramienta analítica seria; es un producto de entretenimiento.
*   **Tono híbrido:** la experiencia principal (métricas gratuitas y la mayoría de las PRO) mantiene el tono divertido/lúdico. Existe una **sección específica "picante"** (Detector de Red Flags, ver `01_Requisitos_y_Alcance.md`) que puede tener una identidad visual levemente distinta dentro de la misma app (ej. paleta más oscura/dramática, iconografía de "alerta") para diferenciarla del resto del recorrido, sin que ese tono domine toda la marca.
*   **Tipografía:** Fuentes modernas, grandes y legibles (ej. Poppins, Montserrat o Inter).
*   **Paleta de Colores:** Gradientes vibrantes, fondos oscuros con colores neón para contrastar, o paletas pasteles altamente saturadas.
*   **Idioma:** toda la interfaz debe soportar español e inglés; el diseño de componentes de texto debe contemplar que las traducciones pueden variar en longitud (evitar textos con ancho fijo muy ajustado).

## 2. Flujo del Usuario (User Journey)
1.  **Landing Page:** Título atractivo ("Descubre la verdad de tus chats" / "Discover the truth about your chats"), propuesta de valor clara (Gratis, Privado, Seguro). Botón de llamada a la acción (CTA): "Analizar un chat ahora". Debe comunicar honestamente que se requiere cuenta de Google para guardar resultados, sin ocultarlo.
2.  **Autenticación:** Modal o redirección para "Continuar con Google". Obligatoria antes de poder subir un archivo.
3.  **Upload Area:** . Zona de *Drag & Drop* para subir el archivo `.txt` o `.zip`. Instrucciones visuales (gif/video corto) de cómo exportar el chat desde WhatsApp. Debe dejar explícito (mensaje de confianza) que el archivo se procesa en el navegador y no se sube el chat completo a ningún servidor.
4.  **Pantalla de Carga (Loading):** Mientras Javascript procesa el archivo localmente, mostrar mensajes divertidos ("Contando tus audios eternos...", "Buscando quién clavó más el visto...").
5.  **Presentación de Resultados (El 'Wrapped'):**
    *   Al terminar de cargar debe pedirle al usuario que se loguee. Luego cuando este logueado debe direccionarlo a pestaña nueva (dentro de la misma pagina). Arriba a la derecha le debe aparecer un logo de usuario (para mostrar que esta logueado). En esta nueva pagina se va a mostar toda la info del chat. Formato de presentación tipo "diapositivas" (stories) que el usuario puede tocar para avanzar a la siguiente métrica.
    *   Las metricas que sean gratuitas no las catalogues como "gratuita", simplemente mostrala. Y las que son VIP son las que deben aparecer blureadas.
    *   Animaciones suaves (framer-motion en React). Ojo con el blur, no debe poder sacarse simplemente con CSS.
    *   Las métricas PRO aparecen intercaladas en el recorrido, pero **visualmente bloqueadas/con blur**, mostrando un preview parcial (ej. el número tapado, o la forma del gráfico sin los valores) para generar curiosidad, con un CTA claro para desbloquear.
    *   Un dashboard final resumen con todas las métricas juntas (las gratuitas visibles, las PRO bloqueadas si no hay suscripción/trial activo).
6.  **Paywall (Upselling):** Al tocar una métrica PRO bloqueada, se abre un modal/pantalla de paywall que debe comunicar claramente dos caminos posibles, no solo uno:
    *   **Opción A — Iniciar trial gratis de 1 semana:** requiere cargar un método de pago; debe explicitarse con claridad ("no se te cobra nada hoy, el primer cobro será el [fecha] salvo que canceles antes") para evitar la sensación de "letra chica" que generó quejas en apps de referencia.
    *   **Opción B — Suscribirse directamente** (si el usuario ya usó su trial antes, o prefiere no usarlo).
    *   Selector de plan (semanal / anual) visible en el mismo paso.
    *   Selector/detección de pasarela de pago disponible (Mercado Pago para Argentina/Latam, Stripe/PayPal para el resto).
7.  **Dashboard Personal:** Una sección donde el usuario puede ver la lista de todos los chats que ha analizado anteriormente (cargados desde la BD del backend, solo resultados agregados). Debe incluir también un panel simple de "Mi suscripción" donde el usuario vea su estado actual (en trial, activa, cancelada, próxima fecha de cobro) y pueda cancelar fácilmente — la facilidad para cancelar es tan importante como la facilidad para suscribirse, ya que reduce fricción de confianza y disputas de cobro.

## 3. Principio de diseño para el paywall
El paywall debe sentirse como una invitación, no como un bloqueo agresivo: se recomienda que el usuario siempre pueda ver *algo* de cada métrica PRO (aunque sea difuminado o parcial) antes de decidir suscribirse, en vez de ocultarla por completo. Esto está alineado con la lógica de negocio descripta en `05_Monetizacion_y_Suscripciones.md` (preview + trial como los dos mecanismos combinados de conversión).

Si alguna opcion pro esta vacia (porque en el chat no hay algo para mostrar en esa categoria). No se debe mostrar la misma. Ni siquiera blureada. Simplemente no se debe mostrar.
