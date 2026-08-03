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

## Configurar Mercado Pago (suscripciones con Payment Brick)

Plan único: **$7.800 ARS por mes**, con **1 semana de prueba gratis** para la primera
suscripción. El checkout es el [Card Payment
Brick](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/card-payment-brick/introduction)
de Mercado Pago **embebido en la propia app** — la tarjeta se completa en un formulario
que aparece ahí mismo (en el popover de "Desbloquear VIP" o en `/suscripcion`), nunca hay
una redirección a mercadopago.com. Ya no se usa el link de pago que habías pasado antes
(`https://mpago.la/2pihzoE`): sigue existiendo como plan en tu panel de Mercado Pago, pero
la app no lo usa más.

Cómo entran los datos de la tarjeta al sistema, en dos pasos:

1. **En el navegador**, el Brick (`@mercadopago/sdk-react`) captura los campos de
   tarjeta —número, vencimiento, código de seguridad— en **iframes de Mercado Pago**, no
   en el DOM de la app: ese texto nunca es legible por nuestro código ni viaja a nuestro
   backend. El Brick lo tokeniza directo contra Mercado Pago y entrega un `token` de un
   solo uso.
2. **El backend** recibe ese `token` (`POST /api/subscription/checkout`) y llama a
   `POST /preapproval` con `card_token_id`, autorizando la suscripción ahí mismo — la
   respuesta ya dice si quedó en `trial` o `activa`, sin pasos intermedios.

> ⚠️ **Bloqueo activo del lado de Mercado Pago — probado, no es un bug de este código.**
> Con tus credenciales de test, `POST /preapproval` con `card_token_id` devuelve
> siempre **404 `"Card token service not found"`**, sin importar si el token es nuevo, si
> viene de una tarjeta guardada en un Customer, o si se tokeniza con la public key o con
> el access token. Repro exacta (con tu access token de test):
> ```bash
> curl -X POST "https://api.mercadopago.com/v1/card_tokens?public_key=TEST-2b072cf5-bf1a-47cb-aec0-5a1f07458e8c" \
>   -H "Content-Type: application/json" \
>   -d '{"card_number":"5031755734530604","security_code":"123","expiration_month":11,"expiration_year":2030,"cardholder":{"name":"APRO","identification":{"type":"DNI","number":"12345678"}}}'
> # devuelve un token válido — hasta acá anda bien
>
> curl -X POST "https://api.mercadopago.com/preapproval" \
>   -H "Authorization: Bearer TEST-4188444718723319-080223-b4cdfce44f8501a236b8719b04b5043b-1654404229" \
>   -H "Content-Type: application/json" \
>   -d '{"preapproval_plan_id":"36559e9e0fe24550a71ca3c4d58c8add","card_token_id":"EL_TOKEN_DE_ARRIBA","payer_email":"tu-email","status":"authorized"}'
> # {"message":"Card token service not found","status":404}
> ```
> No es un caso aislado: es el mismo error, con el mismo texto, que otro desarrollador
> reportó en el [foro oficial de
> Mercado Pago](https://github.com/mercadopago/sdk-nodejs/discussions/362) intentando
> exactamente esto mismo. Construí todo según la documentación oficial (que sí describe
> `card_token_id` como campo válido de `/preapproval`), así que lo más probable es que
> sea (a) algo que se resuelve pasando a credenciales de **producción** en vez de test, o
> (b) una función que Mercado Pago tiene que habilitarte en la cuenta/aplicación. Con el
> repro de arriba en mano, valdría la pena escribirle a soporte de desarrolladores de
> Mercado Pago citando ese mismo error. Mientras tanto, la app ya queda **completamente
> lista**: en el momento en que ese llamado empiece a funcionar de tu lado, todo el resto
> (trial, webhook, cancelación, historial) ya está enchufado y no hace falta tocar nada
> más.

### 1. Credenciales (ya cargadas para pruebas)

Las credenciales de **test** que pasaste ya están en el repo, listas para probar:

- Backend (`backend\appsettings.Development.json`, sección `MercadoPago`): `AccessToken`
  y `PublicKey`.
- Frontend (`frontend\.env`): `VITE_MERCADO_PAGO_PUBLIC_KEY`.

Para pasar a producción:

```bash
cd backend
dotnet user-secrets set "MercadoPago:AccessToken" "APP_USR-..."
dotnet user-secrets set "MercadoPago:WebhookSecret" "..."
```

Y en `frontend\.env`, reemplazá `VITE_MERCADO_PAGO_PUBLIC_KEY` por la public key de
producción (esta sí puede ir en el repo — a diferencia del access token, una public key
está pensada para exponerse en el navegador).

> Igual que la key de IA: el **access token** y el **webhook secret** no van en
> `appsettings.json` ni en `appsettings.Development.json` cuando son de producción —
> esos archivos están trackeados por git. Los de test sí quedaron ahí porque no mueven
> plata real. Con variables de entorno los nombres son `MercadoPago__AccessToken` y
> `MercadoPago__WebhookSecret`.

Apenas el backend arranca, avisa qué credenciales está usando:

```
info: Payments[0] Mercado Pago ready (test credentials): 7800 ARS every 1 months, 7 days free trial.
```

### 2. Cuentas y tarjetas de prueba

Para simular compradores reales en el sandbox de Mercado Pago (por ejemplo, si probás el
checkout desde el propio sitio de Mercado Pago en vez de por API):

| Rol | User ID | Usuario | Contraseña | Código de verificación |
| --- | --- | --- | --- | --- |
| Comprador | `3587267080` | `TESTUSER3495729252306500887` | `avlnIQqBTf` | `267080` |
| Vendedor | `3587267082` | `TESTUSER4000554943837637660` | `eiukCdxpbt` | `267082` |

Tarjetas de prueba (Argentina) — cualquiera de estas funciona con el Brick:

| Tarjeta | Número | Código de seguridad | Vencimiento |
| --- | --- | --- | --- |
| Mastercard | `5031 7557 3453 0604` | `123` | `11/30` |
| Visa | `4509 9535 6623 3704` | `123` | `11/30` |
| American Express | `3711 803032 57522` | `1234` | `11/30` |
| Mastercard Débito | `5287 3383 1025 3304` | `123` | `11/30` |
| Visa Débito | `4002 7686 9439 5619` | `123` | `11/30` |

El **nombre del titular** que cargues en el Brick simula el resultado del pago (DNI
`12345678` donde aplica):

| Nombre del titular | Resultado |
| --- | --- |
| `APRO` | Pago aprobado |
| `CONT` | Pendiente de pago |
| `CALL` | Rechazado — necesita validación |
| `FUND` | Rechazado — importe insuficiente |
| `SECU` | Rechazado — código de seguridad inválido |
| `EXPI` | Rechazado — problema con el vencimiento |
| `FORM` | Rechazado — error de formulario |
| `OTHE` | Rechazado — error general |

### 3. Webhook (necesario para que el acceso se otorgue solo)

Sin esto, el bloqueo de arriba aparte, **nadie recibiría el acceso Pro automáticamente**
apenas se resuelva — vos tendrías que activarlo a mano por cada pago. En el
[panel de Mercado Pago](https://www.mercadopago.com.ar/developers/panel) → tu aplicación
→ **Webhooks**, registrá la URL pública:

```
https://TU-DOMINIO/api/webhooks/mercadopago
```

Suscribite a los eventos **Suscripciones** (`subscription_preapproval`) y **Pagos de
suscripción** (`subscription_authorized_payment`). Copiá la **clave secreta** que muestra
el panel y guardala como `MercadoPago:WebhookSecret`.

> Sin ese secreto **toda notificación se rechaza con 401** y ninguna suscripción llega a
> activarse. Es a propósito: un webhook sin firma verificada es un endpoint público que
> reparte acceso pago a quien adivine la URL.

Para probar en local, exponé el puerto 5175 con un túnel (ngrok, Cloudflare Tunnel) y usá
esa URL. También podés forzar una reconciliación desde `/suscripcion` con **Actualizar
estado**, que vuelve a leer todo desde Mercado Pago sin depender del webhook.

### 4. Ajustes

Todo en `backend\appsettings.json`, bajo `MercadoPago`:

| Clave | Default | Para qué sirve |
| --- | --- | --- |
| `TransactionAmount` | `7800` | Precio mensual mostrado en la app. **Tiene que coincidir con lo que cobra el plan real** en Mercado Pago. |
| `CurrencyId` | `ARS` | Moneda. |
| `Frequency` / `FrequencyType` | `1` / `months` | Ciclo de facturación. |
| `TrialFrequency` / `TrialFrequencyType` | `7` / `days` | Duración del trial. |
| `FailedPaymentGraceDays` | `3` | Días de acceso tras un cobro rechazado, mientras Mercado Pago reintenta. |
| `PreapprovalPlanId` | tu plan real (`36559e9e0fe24550a71ca3c4d58c8add`) | El plan al que se atan las suscripciones nuevas. |
| `AutoCreatePlan` | `true` | Si `PreapprovalPlanId` estuviera vacío, crea uno solo la primera vez. |

### 5. Anti-abuso del trial

La semana gratis se otorga una sola vez, y se controla por tres vías a la vez (en
`backend\appsettings.json`, sección `TrialGuard`):

| Regla | Default | Nota |
| --- | --- | --- |
| Por cuenta de Google | siempre activa | Exacta, pero crear otra cuenta es gratis. |
| Por IP (`LockByIp`) | `true` | Es la que corta el "me deslogueo y entro con otro Gmail". |
| Por dispositivo (`LockByDevice`) | `true` | Id aleatorio en `localStorage`; se pierde si borran datos del sitio. |
| Por red /24 (`LockBySubnet`) | `false` | **Dejalo apagado** salvo que sepas lo que hacés: las redes móviles argentinas meten miles de clientes distintos detrás del mismo rango (CGNAT) y bloquearías gente que nunca usó el trial. |
| Por país (`AllowedCountries`) | `[]` | Ej. `["AR"]`. Solo se aplica cuando el país es **conocido de verdad** (headers de CDN, con `TrustProxyHeaders: true`); nunca se adivina por geolocalización de IP, que un VPN tumba. |

Las IPs y los ids de dispositivo se guardan **hasheados con sal**: la tabla solo necesita
responder "¿ya lo vi?", nunca "¿quién era?".

> `TrustProxyHeaders` viene en `false`. Prendelo **solo** cuando la app esté detrás de un
> proxy/CDN que reescriba `X-Forwarded-For`: si no, cualquiera manda ese header y se
> regala un trial nuevo.

### 6. Botones de desarrollo (solo localhost)

Arriba a la derecha aparecen dos switches que **no existen fuera de localhost**:

- **IA activada / desactivada** — con la IA apagada, importar un chat no dispara ninguna
  llamada a Gemini. Sirve para iterar sobre la app sin quemar tokens sin querer. Queda
  guardado entre recargas.
- **Activar / desactivar suscripción** — crea (o borra) una suscripción Pro simulada para
  ver la experiencia VIP sin pagar. No es un flag de frontend: es una fila real marcada
  con `IsDevSimulated`, así que atraviesa el mismo gate de Pro que un cliente que pagó.

El endpoint que respalda el segundo exige **dos** condiciones: entorno `Development` **y**
que la request venga de loopback. Un build de producción mal configurado sigue sin regalar
Pro por internet.

### 7. Producción: el hosting necesita fallback a `index.html`

`/suscripcion` es una ruta que solo existe del lado del cliente (no hay un servidor atrás
que la sirva) — en desarrollo, Vite ya resuelve esto solo. En producción, el hosting tiene
que estar configurado para devolver `index.html` ante **cualquier** ruta que no sea un
archivo real (lo que en Netlify es un `_redirects` con `/* /index.html 200`, en Vercel un
rewrite, en Nginx un `try_files ... /index.html`). Sin eso, entrar directo a
`/suscripcion` — o refrescar estando ahí — da un 404 del servidor en vez de la página.

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
- Suscripciones con Mercado Pago de punta a punta: checkout embebido con el Card Payment Brick (sin redirecciones), trial de 1 semana, cobro mensual recurrente, webhooks con firma verificada, cancelación, historial de pagos y auditoría de eventos — bloqueado hoy solo por el 404 de Mercado Pago documentado más arriba, no por nada de este lado
- `/suscripcion`: ruta propia (no un modal), con diseño más formal separado del resto de la app — estado del plan, selector de plan desplegable con precio/beneficios/trial, historial de pagos y de suscripciones, y actividad de la cuenta. Se llega ahí desde el menú de la cuenta (**Gestionar suscripción**)
- "Desbloquear VIP" en cualquier tarjeta bloqueada abre un **popover** con el plan y el formulario de tarjeta directo (sin el desplegable del plan, que solo tiene sentido en `/suscripcion`) — comprar no saca al usuario de donde estaba

## Qué no está implementado todavía

- **El cobro real todavía no se puede completar**: `POST /preapproval` con `card_token_id`
  devuelve 404 del lado de Mercado Pago con las credenciales de test — ver la sección de
  Mercado Pago más arriba para la repro exacta y qué probar para destrabarlo
- Más métricas con IA (Análisis de Sentimiento, Lector de Mentes) — la integración con
  Google AI Studio ya está, falta definir el prompt de cada una en
  `backend\Services\AiMetricPrompts.cs` y sumarlas a `aiMetricIds` en `frontend\src\lib\metrics.ts`
- Reintentar una métrica de IA fallida desde un análisis abierto del historial: hace falta
  volver a subir el chat, porque los mensajes crudos nunca se guardan del lado del navegador
- Stripe / PayPal para el mercado internacional (Mercado Pago ya está; estos quedarían para cobrar en USD)
- Aviso por email antes del primer cobro al terminar el trial y cuando una tarjeta es rechazada (hoy el estado se ve solo dentro de la app)
- OCR y fuentes de datos fuera de WhatsApp
- "El Viajero del Tiempo" (necesita metadata de "responder a" que no existe en el `.txt`/`.zip` exportado)
- Exportación HD como PDF real (por ahora es un candidato a implementarse vía impresión del navegador)
