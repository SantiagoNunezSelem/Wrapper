# Algoritmos y Procesamiento de Datos

## 1. Formato de Entrada Esperado
El sistema debe procesar archivos de texto exportados nativamente desde WhatsApp. Un ejemplo de la estructura esperada es:

`[Fecha, Hora] - Remitente: Mensaje`

Ejemplo concreto (basado en exportación estándar):
`20/1/2026 15:30 - Juan: Hola, ¿cómo estás?`
`20/1/2026 15:31 - Maria: Todo bien, ¿vos?`

Nota: el formato exacto de fecha/hora exportado por WhatsApp varía según el idioma del teléfono, la región (formato de fecha DD/MM/AAAA vs MM/DD/AAAA) y la versión de la app (algunos exports usan corchetes `[20/1/2026, 15:30:00]` y otros no). El parser debe ser tolerante a estas variantes, o al menos documentar claramente qué variantes soporta el MVP y ofrecer un mensaje de error claro al usuario si el formato no es reconocido.

## 2. Extracción mediante Expresiones Regulares (Regex)
La IA desarrolladora debe crear un parser robusto en Javascript.
*   **Patrón Base:** Debe identificar la fecha, la hora, capturar el nombre del remitente y el contenido del mensaje.
*   **Mensajes Multilínea:** El parser debe estar preparado para mensajes que contienen saltos de línea (si un renglón no empieza con formato de Fecha/Hora, pertenece al mensaje de la línea anterior).
*   **Eventos del Sistema:** Ignorar o procesar distinto los mensajes generados por WhatsApp, por ejemplo: `"Los mensajes y las llamadas están cifrados de extremo a extremo..."` o `"Juan eliminó este mensaje"`.
*   **Multimedia:** Identificar líneas que contienen exactamente `<Media omitted>` o `<Multimedia omitido>` para la métrica de "Fan de la multimedia".
*   **Idioma del export:** dado que la app soporta español e inglés (ver `01_Requisitos_y_Alcance.md`), el parser debe contemplar que los mensajes de sistema de WhatsApp (cifrado, eliminación de mensajes, etc.) pueden venir en distintos idiomas según la configuración del teléfono del usuario que exportó el chat. Se recomienda mantener una lista de frases de sistema conocidas por idioma, fácilmente extensible.

## 3. Estructura de Datos Intermedia
Durante el procesamiento local, los mensajes deben transformarse en un array de objetos estandarizado:
```json
[
  {
    "timestamp": "2026-01-20T15:30:00",
    "sender": "Juan",
    "message": "Hola, ¿cómo estás?",
    "isMedia": false,
    "wordCount": 3
  }
]
```

## 4. Consideraciones para métricas PRO sobre esta estructura
Algunas métricas PRO (ver `01_Requisitos_y_Alcance.md`, sección 3.2) requieren procesamiento adicional sobre este array estandarizado, todo calculable en el cliente salvo el análisis de sentimiento:
*   **El Clavavistos / Rachas de Inactividad:** requieren calcular deltas de tiempo (`timestamp`) entre mensajes consecutivos de distinto remitente (tiempo de respuesta) y entre mensajes consecutivos en general (inactividad), excluyendo mensajes de sistema.
*   **Detector de Red Flags / Índice de Cringe:** requieren un diccionario configurable de palabras/frases (por idioma) a buscar dentro de `message`, con conteo de frecuencia por remitente. Debe diseñarse como una lista externa/configurable (no hardcodeada en el algoritmo) para poder ajustar el diccionario sin tocar el código del parser, y debe tener una versión en español y otra en inglés.
*   **Análisis de Sentimiento (Radar de Vibras):** es la única métrica que requiere salir del navegador. Solo debe enviarse al backend el texto estrictamente necesario (por ejemplo, una muestra representativa de mensajes, no el chat completo) y solo si el usuario tiene acceso PRO activo (trial o suscripción), validado por el backend antes de hacer la llamada a la API de IA externa.
