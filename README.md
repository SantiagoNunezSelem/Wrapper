# Wrapper CRM

Arquitectura inicial del proyecto basada en los documentos de `Project_Context\`:

- **Frontend:** React + Vite + TypeScript
- **Backend:** ASP.NET Core 9 + SQLite
- **Auth:** Google Sign-In validado por el backend
- **Persistencia:** usuarios, análisis guardados y estado de suscripción/VIP
- **Procesamiento del chat:** 100% client-side, sin enviar el texto crudo al servidor

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

- Integraciones con IAs externas (Análisis de Sentimiento, Lector de Mentes)
- Webhooks reales de Stripe / Mercado Pago / PayPal y el flujo de pago/checkout de la suscripción VIP
- OCR y fuentes de datos fuera de WhatsApp
- "El Viajero del Tiempo" (necesita metadata de "responder a" que no existe en el `.txt`/`.zip` exportado)
- Exportación HD como PDF real (por ahora es un candidato a implementarse vía impresión del navegador)
