# Resumen Ejecutivo y Diferenciación Competitiva

## 1. Qué es este proyecto
Una aplicación web Freemium (nombre por definir) que permite a los usuarios subir el historial de un chat de WhatsApp exportado (`.txt` o `.zip`) y recibir un análisis estadístico dinámico de la conversación, presentado en formato "stories/wrapped" (estilo Spotify Wrapped / Instagram Stories).

El procesamiento de los mensajes es 100% client-side (en el navegador del usuario), y solo los resultados agregados (JSON de métricas, nunca el texto crudo de los mensajes) se envían y almacenan en un backend propio, asociados a una cuenta de Google.

Este documento existe para que una IA de desarrollo (o un equipo humano) entienda rápidamente el proyecto, su fuente de inspiración, y en qué se parece y en qué se diferencia intencionalmente de esa inspiración, antes de leer el resto de la documentación técnica y funcional.

## 2. Inspiración: "The Cringe: Chat Wrapped"
El proyecto toma como referencia directa la app móvil **"The Cringe: Chat Wrapped"** (disponible en Google Play y App Store, paquete `io.thecringe.app`). Ver el archivo `06_Referencia_Competencia_The_Cringe.md` para el detalle completo de la investigación. En resumen:
- Analiza chats exportados de WhatsApp (y también capturas de pantalla de iMessage/Instagram/Snapchat vía OCR).
- Métricas centrales: conteo de mensajes por persona, tiempo de respuesta promedio, frecuencia de palabras, "gaps" o inconsistencias.
- Tono de marketing "picante": se posiciona como un "red flag test" para analizar a tu pareja, ex o crush.
- Monetización: suscripción recurrente (semanal ~$9.99 USD, anual ~$30-45 USD), sin trial gratuito (punto de fricción criticado en reseñas).
- Afirma privacidad total: cero almacenamiento de datos, todo procesado localmente, sin login.

## 3. Qué copiamos y qué diferenciamos a propósito

| Aspecto | The Cringe (referencia) | Nuestro proyecto |
|---|---|---|
| Fuente de datos | WhatsApp export + capturas de pantalla (OCR multi-app) | **Solo** WhatsApp export (`.txt`/`.zip`). Sin OCR ni otras apps (al menos en MVP) |
| Cuenta de usuario | Sin login, sin cuenta | **Login obligatorio con Google.** Se guarda historial de análisis en backend |
| Almacenamiento | Cero almacenamiento (según su marketing) | Se procesa localmente, pero **sí se guardan los resultados agregados** (JSON de métricas) en el perfil del usuario para poder ver análisis pasados |
| Tono | Picante / "red flag test", enfocado en parejas y ex | **Híbrido**: base divertida y lúdica (estilo Spotify Wrapped) + una sección específica "picante" de red flags/tensión, no es el eje central de toda la app |
| Monetización | Suscripción recurrente sin trial | Suscripción recurrente **con free trial de 1 semana**, requiriendo método de pago cargado desde el inicio (cobro $0 la primera semana, luego automático) |
| Precios | ~USD 9.99/semana, ~USD 30-45/año | Precios propios, pensados para el mercado LatAm/Argentina (montos menores, ver `05_Monetizacion_y_Suscripciones.md`) |
| Pasarelas de pago | No especificado (probablemente stores nativos, Apple/Google billing) | Mercado Pago (foco Argentina/Latam), Stripe y PayPal (mercado internacional), gestionadas vía backend propio con webhooks |
| Idioma | Inglés | Español e inglés desde el MVP |
| Plataforma | App móvil nativa (iOS/Android) | Aplicación **web** (React/Next.js), responsive, sin necesidad de descargar nada |

## 4. Filosofía del producto
- **Privacidad como valor central en el mensaje, pero con cuenta.** A diferencia de The Cringe, sí pedimos login y guardamos resultados, pero seguimos comunicando que los mensajes originales nunca salen del navegador del usuario (solo las métricas calculadas).
- **Freemium accesible, no un muro de pago agresivo.** Las métricas más divertidas y compartibles están gratis; lo analítico/profundo (tiempos de respuesta, red flags, sentimiento) es PRO, con preview bloqueado/borroso como incentivo, más un trial de 1 semana real (con tarjeta cargada) para bajar la fricción de conversión sin regalar el producto.
- **Entretenimiento primero, "juicio" después.** El corazón del producto es la experiencia tipo Wrapped (compartible, visual, divertida). La veta "red flags/cringe" es un condimento adicional, no el posicionamiento completo de la marca (a diferencia de The Cringe).

## 5. Documentos que componen esta especificación
1. `00_Resumen_Ejecutivo_y_Diferenciacion.md` — este documento.
2. `01_Requisitos_y_Alcance.md` — PRD: funcionalidades free y PRO, alcance del MVP.
3. `02_Arquitectura_Tecnica.md` — stack, arquitectura híbrida cliente/servidor, modelo de datos, autenticación.
4. `03_Procesamiento_Datos_y_Regex.md` — parsing del export de WhatsApp, estructura de datos intermedia.
5. `04_UI_UX_Diseño.md` — estilo visual, tono, flujo de usuario, pantallas.
6. `05_Monetizacion_y_Suscripciones.md` — modelo de suscripción, trial, pasarelas de pago, ciclo de vida de webhooks.
7. `06_Referencia_Competencia_The_Cringe.md` — investigación de la app de referencia.

Se recomienda leer este documento primero, luego `01_Requisitos_y_Alcance.md`, y después el resto en cualquier orden según la fase de desarrollo (arquitectura, procesamiento de datos, UI, o monetización).
