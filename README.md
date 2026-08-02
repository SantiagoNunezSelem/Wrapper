# Wrapper CRM

Arquitectura inicial del proyecto basada en los documentos de `Project_Context\`:

- **Frontend:** React + Vite + TypeScript
- **Backend:** ASP.NET Core 9 + SQLite
- **Auth:** Google Sign-In validado por el backend
- **Persistencia:** usuarios, análisis guardados y estado de suscripción/VIP
- **Procesamiento del chat:** client-side. La única excepción son dos métricas Pro con IA, que envían al backend solo los mensajes ya filtrados (ver más abajo)
- **IA:** Google AI Studio (Gemini), llamado siempre desde el backend para que la API key nunca llegue al navegador

## Estructura

- `frontend\` — app web, parser de export de WhatsApp y dashboard de métricas
- `backend\` — API, login con Google, JWT, SQLite y guardado de análisis
- `Project_Context\` — especificación funcional y técnica fuente

## Configurar Google Login

1. Crear un proyecto en Google Cloud.
2. Habilitar **Google Identity Services / OAuth**.
3. Crear un **OAuth Client ID** de tipo **Web application**.
4. Configurar como origen autorizado:
   - `http://localhost:5173`
5. Copiar el client ID generado.

## Configurar el backend

1. Abrí `backend\appsettings.Development.json`.
2. Reemplazá:
   - `GoogleAuth:AllowedAudience` por tu **Google Web Client ID**
   - `AdminSeed:Email` por **tu cuenta de Google real**
3. Ese email se sembrará como **admin VIP** y, cuando ingreses con Google usando esa cuenta, tendrás acceso VIP completo.

## Configurar el frontend

1. Copiá `frontend\.env.example` a `frontend\.env`.
2. Reemplazá `VITE_GOOGLE_CLIENT_ID` por el mismo **Google Web Client ID** usado en el backend.

## Configurar Google AI Studio (métricas con IA)

Dos métricas Pro — **Detector de Red Flags** y **El Tono Picante** — se apoyan en filtros de
palabras que producen falsos positivos ("la comida estaba caliente" no es un mensaje subido
de tono). La IA revisa esos mensajes ya marcados y descarta los que no corresponden.

1. Entrar a [Google AI Studio](https://aistudio.google.com/) con tu cuenta de Google.
2. Crear una **API key** (menú *Get API key*).
3. Cargarla **fuera del repo**, con user secrets:

```bash
cd backend && dotnet user-secrets set "GoogleAi:ApiKey" "TU_API_KEY"
```

   O, si preferís variables de entorno, `GoogleAi__ApiKey`.

> No la pongas en `appsettings.json` ni en `appsettings.Development.json`: esos archivos
> están trackeados por git.

El resto de la configuración vive en `backend\appsettings.json`, bajo `GoogleAi`:

| Clave | Default | Para qué sirve |
| --- | --- | --- |
| `Model` | `gemini-3.1-flash-lite` | Modelo a usar. Google da de baja modelos viejos para keys nuevas cada tanto (a nosotros nos pasó con `gemini-2.5-flash-lite`, ver nota en `GoogleAiOptions.cs`); si empieza a fallar con 404, pedí `GET /v1beta/models` con tu key y elegí otro `-lite` no-preview de la lista. |
| `MaxSnippetsPerMetric` | `300` | Techo de fragmentos por chat y métrica. Es el freno principal de gasto. |
| `BatchSize` | `40` | Fragmentos por llamada. |
| `RetryCooldownSeconds` | `120` | Espera antes de poder reintentar una métrica que falló. |
| `ThinkingBudget` | `0` | Desactiva los tokens de razonamiento. Poner `-1` si el modelo elegido rechaza el campo. |

### Cómo se controla el gasto

- **Sin Pro no hay llamada.** El endpoint rechaza al usuario antes de armar cualquier prompt.
- **Sin consentimiento tampoco.** El usuario Pro tiene que autorizarlo una vez.
- **Una vez por chat.** El veredicto se guarda en la tabla `AiMetricResults` y se reutiliza
  para siempre; volver a subir el mismo export no cuesta nada.
- **Nunca se manda el chat.** Solo los mensajes que ya pasaron el filtro de palabras,
  recortados a 50 palabras alrededor de la palabra clave, con un par de líneas de contexto
  y con los nombres reemplazados por letras.

## Levantar el backend

```powershell
cd backend
dotnet run
```

La API queda disponible en:

- `http://localhost:5175`

## Levantar el frontend

```powershell
cd frontend
npm install
npm run dev
```

La app queda disponible en:

- `http://localhost:5173`

## Cómo entrar con el usuario VIP

1. En `backend\appsettings.Development.json`, poné tu correo real de Google en `AdminSeed:Email`.
2. Iniciá backend y frontend.
3. Abrí `http://localhost:5173`.
4. Tocá **Sign in with Google / Entrá con Google**.
5. Elegí esa misma cuenta de Google.
6. El backend la registrará o actualizará y le asignará el rol **admin** con suscripción VIP activa.

## Qué implementa esta base

- Login con Google validado en backend
- Persistencia de usuario y análisis, con deduplicación por hash del chat (re-subir el mismo `.txt` actualiza la fila existente en vez de duplicarla)
- Usuario admin/VIP configurable por email
- Parser local de `.txt` y `.zip` exportados por WhatsApp, que excluye los marcadores automáticos de WhatsApp (`<Media omitted>`, `<This message was edited>`, etc.) de las estadísticas de texto
- Dashboard con 12 métricas gratis y 13 VIP (intercaladas, sin catalogar a las gratuitas como "gratis"), cada una con gráfico (barras, dona, heatmap horario/anual, radar, calendario de rachas, timeline o nube de palabras) y una vista de detalle paginada por integrante
- El botón "Ver más" (desglose por integrante) es una función VIP para **todas** las métricas, incluidas las gratuitas — solo la vista básica de cada tarjeta depende de si esa métrica en particular es gratis o VIP
- Gating VIP real: los datos bloqueados nunca se calculan hacia el estado de React ni al DOM (no es un blur solo de CSS); al desbloquear VIP se recalcula localmente con los mensajes ya parseados

## Qué no está implementado todavía

- Más métricas con IA (Análisis de Sentimiento, Lector de Mentes) — la integración con
  Google AI Studio ya está, falta definir el prompt de cada una en
  `backend\Services\AiMetricPrompts.cs` y sumarlas a `aiMetricIds` en `frontend\src\lib\metrics.ts`
- Reintentar una métrica de IA fallida desde un análisis abierto del historial: hace falta
  volver a subir el chat, porque los mensajes crudos nunca se guardan del lado del navegador
- Webhooks reales de Stripe / Mercado Pago / PayPal y el flujo de pago/checkout de la suscripción VIP
- OCR y fuentes de datos fuera de WhatsApp
- "El Viajero del Tiempo" (necesita metadata de "responder a" que no existe en el `.txt`/`.zip` exportado)
- Exportación HD como PDF real (por ahora es un candidato a implementarse vía impresión del navegador)
