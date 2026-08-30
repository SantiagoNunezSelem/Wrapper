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
- `backend.Tests\` — pruebas de los servicios y de los 23 endpoints
- `Project_Context\` — especificación funcional y técnica fuente

## Tests

Corren solos en cada pull request (ver `.github\workflows\tests.yml`). A mano:

```bash
cd frontend && npm test
```

```bash
dotnet test Wrapper.sln
```

Cómo está armada la suite, qué umbrales de cobertura se exigen y qué desfasajes contra la
especificación destaparon las pruebas: **[TESTING.md](TESTING.md)**.

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

`frontend\.env` no viaja en el repo (está en `.gitignore`, junto con el resto de los
`.env*`), así que hay que crearlo a mano con:

```
VITE_API_URL=http://localhost:5175
VITE_GOOGLE_CLIENT_ID=<el mismo Google Web Client ID usado en el backend>
```

En producción, sumá además `VITE_SITE_URL` con el origen público del sitio (sin barra
final, p. ej. `https://vistazo.app`).

> `VITE_SITE_URL` sirve para una sola cosa: las etiquetas Open Graph de `index.html`.
> `vite.config.ts` la usa para reemplazar el marcador `__SITE_URL__` y dejar la imagen
> de la vista previa en una URL absoluta, que es lo que piden los crawlers que arman
> la tarjeta al pegar un link en WhatsApp. Vacía (el default) las rutas quedan
> relativas, que es lo correcto en local.

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

## Configurar Mercado Pago (suscripciones)

Plan único: **$7.800 ARS por mes**, con **1 semana de prueba gratis** para la primera
suscripción.

El checkout **crea una suscripción propia para cada pagador** y lo manda a la página
alojada de Mercado Pago a autorizarla:

1. `POST /api/subscription/checkout` llama a
   [`POST /preapproval`](https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post)
   con `status: "pending"`, `payer_email`, `back_url`, el `auto_recurring` (con
   `free_trial` cuando corresponde) y —lo importante— `external_reference` con el id de
   la fila local.
2. Mercado Pago devuelve el `id` del preapproval y un `init_point`. El id se guarda
   **antes** de mandar a nadie a pagar; el navegador va al `init_point`.
3. El pagador autoriza en la página de Mercado Pago y el preapproval pasa de `pending` a
   `authorized`. La notificación llega por webhook, y la app ya sabe a qué fila
   corresponde.

**Por qué así, y por qué antes quedaba todo en "pendiente".** El camino anterior mandaba a
todos al `init_point` compartido del *plan*. Ese link es anónimo: Mercado Pago crea la
suscripción de su lado con un id que nunca vemos y sin `external_reference`, así que lo
único que quedaba para volver a la fila local era el **mail de la cuenta de Mercado Pago
del pagador** — que muy seguido no es el mismo Gmail con el que se logueó en Vistazo.
Cuando difieren, ni el webhook ni "Actualizar estado" pueden vincularlos: la tarjeta se
cobra y la app dice "pendiente" para siempre.

> **Nota sobre el 404 `"Card token service not found"`.** Ese error aparecía al usar
> `POST /preapproval` con `card_token_id` (el flujo *authorized*, el del Card Payment
> Brick embebido). Este flujo **no manda ningún card token** —la tarjeta se carga del lado
> de Mercado Pago— así que no lo toca. La suscripción con plan asociado sí exige
> `card_token_id` + `status: "authorized"`, y por eso el trial va declarado por
> suscripción en vez de por plan.

Si `POST /preapproval` fuera rechazado (hay cuentas y países donde no está habilitado), el
checkout **cae automáticamente** al link del plan compartido: se pierde el id de arranque,
pero no se pierde la venta. Queda anotado en el log con nivel `Warning`. Se puede forzar
ese camino con `MercadoPago:UseDirectPreapproval: false`.

### 1. Credenciales (ya cargadas para pruebas)

Las credenciales de **test** que pasaste ya están en el repo, listas para probar:

- Backend (`backend\appsettings.Development.json`, sección `MercadoPago`): `AccessToken`
  y `PublicKey`.
- Frontend: nada. La tarjeta se carga en la página de Mercado Pago, así que el
  navegador no necesita ninguna credencial suya. (`VITE_MERCADO_PAGO_PUBLIC_KEY` en
  `frontend\.env` quedó del checkout embebido anterior y ya no se lee.)

Para pasar a producción:

```bash
cd backend
dotnet user-secrets set "MercadoPago:AccessToken" "APP_USR-..."
dotnet user-secrets set "MercadoPago:WebhookSecret" "..."
```

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

Tarjetas de prueba (Argentina):

| Tarjeta | Número | Código de seguridad | Vencimiento |
| --- | --- | --- | --- |
| Mastercard | `5031 7557 3453 0604` | `123` | `11/30` |
| Visa | `4509 9535 6623 3704` | `123` | `11/30` |
| American Express | `3711 803032 57522` | `1234` | `11/30` |
| Mastercard Débito | `5287 3383 1025 3304` | `123` | `11/30` |
| Visa Débito | `4002 7686 9439 5619` | `123` | `11/30` |

El **nombre del titular** simula el resultado del pago (DNI `12345678` donde aplica).
Vale la pena probar `CONT` en particular: es el que reproduce el estado pendiente que la
pantalla ahora explica en vez de sólo nombrar.

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

Suscribite a **los tres** eventos:

| Evento en el panel | Topic | Para qué |
| --- | --- | --- |
| Suscripciones | `subscription_preapproval` | La suscripción cambió de estado (`pending` → `authorized`, pausada, cancelada). |
| Pagos de suscripción | `subscription_authorized_payment` | Cada cobro programado del ciclo. |
| **Pagos** | `payment` | El movimiento de plata en sí. |

> ⚠️ **`payment` no es opcional.** La documentación de Mercado Pago pide habilitarlo junto
> a los otros dos, y para un **primer cobro suele ser la única notificación que llega**.
> Además es el único que trae `status_detail`, que es lo que permite decir *por qué* un
> pago está pendiente (`pending_contingency`, `pending_challenge`, `cc_rejected_…`) en vez
> de repetir la palabra "pendiente". Tenerlo apagado es la causa más común de una
> suscripción pagada que se queda colgada.

Copiá la **clave secreta** que muestra el panel y guardala como
`MercadoPago:WebhookSecret`.

> Sin ese secreto **toda notificación se rechaza con 401** y ninguna suscripción llega a
> activarse. Es a propósito: un webhook sin firma verificada es un endpoint público que
> reparte acceso pago a quien adivine la URL.

Para probar en local, exponé el puerto 5175 con un túnel (ngrok, Cloudflare Tunnel) y usá
esa URL.

**Aun así el webhook no es un punto único de falla.** Tres cosas lo cubren, de más rápida a
más lenta:

1. Al volver del checkout, `/suscripcion` re-consulta sola unas cinco veces (3 s, 6 s, 12 s,
   24 s, 48 s) hasta que el estado deja de ser "pendiente".
2. El botón **Actualizar estado** vuelve a leer todo desde Mercado Pago a pedido.
3. Un **reconciliador en segundo plano** (`SubscriptionReconciliationService`) repasa cada
   15 minutos las suscripciones que están en movimiento —pendientes recientes, cobros
   rechazados, renovaciones vencidas— y aplica lo que Mercado Pago diga. Una notificación
   perdida (topic sin habilitar, secreto rotado, deploy que se comió la entrega) se
   resuelve sola dentro de ese intervalo en vez de convertirse en un ticket.

### 4. Ajustes

Todo en `backend\appsettings.json`, bajo `MercadoPago`:

| Clave | Default | Para qué sirve |
| --- | --- | --- |
| `TransactionAmount` | `7800` | Precio mensual mostrado en la app. **Tiene que coincidir con lo que cobra el plan real** en Mercado Pago. |
| `CurrencyId` | `ARS` | Moneda. |
| `Frequency` / `FrequencyType` | `1` / `months` | Ciclo de facturación. |
| `TrialFrequency` / `TrialFrequencyType` | `7` / `days` | Duración del trial. |
| `FailedPaymentGraceDays` | `3` | Días de acceso tras un cobro rechazado, mientras Mercado Pago reintenta. |
| `PreapprovalPlanId` | tu plan real (`36559e9e0fe24550a71ca3c4d58c8add`) | Solo se usa en el camino de fallback (ver arriba). |
| `AutoCreatePlan` | `true` | Si `PreapprovalPlanId` estuviera vacío, crea uno solo la primera vez. |
| `UseDirectPreapproval` | `true` | Crear un `preapproval` por pagador en vez de mandar al link del plan. **Es el arreglo del "pago pendiente"**; ponelo en `false` solo para volver al camino viejo. |
| `BackUrl` | `http://localhost:5173` | **En producción tiene que ser el origen real del sitio** (`https://vistazo.app`). Mercado Pago rechaza un `back_url` que apunte a localhost, así que con el default el pagador termina en mercadopago.com y nunca vuelve a `/suscripcion` — con lo cual la re-consulta inmediata post-pago no corre. El backend lo avisa al arrancar. |
| `ReconcileIntervalMinutes` | `15` | Cada cuánto corre el reconciliador. `0` lo apaga. |
| `PendingCheckoutHours` | `48` | Cuánto tiempo un checkout sin terminar se sigue ofreciendo para retomar (y se sigue consultando). Después se da por abandonado. |
| `ManageUrl` | `https://www.mercadopago.com.ar/subscriptions` | Adónde manda "Cambiar la tarjeta". Mercado Pago **no tiene API** para reemplazar la tarjeta de un preapproval existente: se hace desde la cuenta del pagador, así que la app linkea en vez de fingir un formulario que no puede guardar. |

### 5. Qué puede hacer el usuario en `/suscripcion`

La pantalla está organizada alrededor de una sola pregunta —*¿qué va a pasar con mi plata
y cuándo?*— porque es a lo que se entra. Arriba de todo, un panel dice el estado, qué
significa, **qué sigue** y el botón que lo cambia; recién después vienen los datos, el
historial de cobros y la auditoría.

| Acción | Endpoint | Qué hace de verdad |
| --- | --- | --- |
| Terminar un pago a medias | — (link guardado) | Vuelve al mismo `init_point`. Abrir un checkout nuevo estando uno pendiente **no crea otro**: se retoma, porque dos suscripciones autorizables son dos cobros mensuales. |
| Actualizar estado | `POST /api/subscription/sync` | Relee el preapproval, sus cobros y el `status_detail` del pago que no cerró. |
| Cancelar renovación | `POST /api/subscription/cancel` | Cancela en Mercado Pago. **El acceso NO se corta**: se conserva hasta el final del período pago. |
| Pausar / Reanudar | `POST /api/subscription/pause` · `/resume` | Suspende los débitos conservando tarjeta y precio. Existe para que "este mes viene difícil" no tenga que ser una cancelación. |
| Cambiar la tarjeta | — (link externo) | Mercado Pago no expone API para reemplazar la tarjeta de un preapproval existente; se linkea a la cuenta del pagador. |

Dos detalles que valen por sí solos:

- **Cancelar durante la prueba gratis dice explícitamente que no se cobra nada**, y no es
  una promesa de marketing: el motor de Mercado Pago es el que agenda el primer débito, así
  que si el preapproval ya no existe cuando llega la fecha, el cobro **no se intenta**. El
  backend decide eso (`CancellationOutcome.NothingWillBeCharged`) mirando el estado que
  Mercado Pago acaba de confirmar, no lo que el usuario clickeó.
- **Un pago pendiente dice por qué.** `status_detail` se traduce a una frase accionable
  ("tu banco pide una confirmación extra", "la tarjeta no tenía saldo suficiente", "Mercado
  Pago lo está procesando, hasta 2 días hábiles"). Un código que no conocemos cae en un
  texto genérico — nunca se muestra el código crudo.

Qué botones existen lo decide el **backend** (`overview.actions`), no la pantalla: si no,
las reglas se separan entre el shell de escritorio y el móvil, y la UI termina ofreciendo
una acción que la API contesta con un 409.

### 6. Anti-abuso del trial

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

**Cuándo se quema y cuándo se devuelve.** La semana se marca como usada al **abrir** el
checkout, no al convertir — así abandonar el pago a mitad de camino no deja la oferta
disponible para siempre. La excepción es cancelar un checkout que Mercado Pago **nunca
llegó a autorizar**: ahí se devuelve, porque esa persona no usó ni un día y "Cancelar" es
su única salida de un pago del que se arrepintió. No abre un agujero: sigue habiendo
exactamente una semana gratis por cuenta cuando finalmente se suscriba, y el registro de
la semana que sí se usó nunca se toca.

> `TrustProxyHeaders` viene en `false`. Prendelo **solo** cuando la app esté detrás de un
> proxy/CDN que reescriba `X-Forwarded-For`: si no, cualquiera manda ese header y se
> regala un trial nuevo.

### 7. Botones de desarrollo (solo localhost)

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

### 8. Producción: el hosting necesita fallback a `index.html`

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

- `https://localhost:5173` si existe un certificado local (ver abajo)
- `http://localhost:5173` si no

### HTTPS local (opcional, recomendado)

Sin esto la app funciona igual, pero Chrome muestra un aviso de "autocompletado
deshabilitado" en el Payment Brick porque el check de autofill de pagos exige `https://`
literal (a diferencia de casi todo lo demás, no le alcanza con que `localhost` cuente
como "contexto seguro"). Es solo estético — la tarjeta la sigue manejando el iframe de
Mercado Pago, que ya es HTTPS — y en producción con un dominio real desaparece solo.

Para sacarlo también en local:

```powershell
winget install -e --id FiloSottile.mkcert
mkcert -install
cd frontend
mkdir .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost-cert.pem localhost 127.0.0.1 ::1
```

`vite.config.ts` detecta esos archivos solos y sirve HTTPS si existen — no hace falta
tocar nada más. `.cert/` está en `.gitignore`: el certificado es local a cada máquina, no
se comparte. `mkcert -install` pide confirmar un diálogo de seguridad de Windows (instala
una autoridad certificadora local) — es un paso que solo un humano puede aceptar.

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
- Borrado de un análisis guardado (`DELETE /api/analyses/{id}`), con confirmación, desde el historial de los dos shells. El id de otra cuenta responde 404 igual que uno inexistente: la respuesta nunca confirma que exista algo ajeno
- Usuario admin/VIP configurable por email
- Parser local de `.txt` y `.zip` exportados por WhatsApp, que excluye los marcadores automáticos de WhatsApp (`<Media omitted>`, `<This message was edited>`, etc.) de las estadísticas de texto
- Dashboard con 12 métricas gratis y 13 VIP (intercaladas, sin catalogar a las gratuitas como "gratis"), cada una con gráfico (barras, dona, heatmap horario/anual, radar, calendario de rachas, timeline o nube de palabras) y una vista de detalle paginada por integrante
- El botón "Ver más" (desglose por integrante) es una función VIP para **todas** las métricas, incluidas las gratuitas — solo la vista básica de cada tarjeta depende de si esa métrica en particular es gratis o VIP
- Gating VIP real: los datos bloqueados nunca se calculan hacia el estado de React ni al DOM (no es un blur solo de CSS); al desbloquear VIP se recalcula localmente con los mensajes ya parseados
- Suscripciones con Mercado Pago de punta a punta: un `preapproval` por pagador con `external_reference` propio, trial de 1 semana, cobro mensual recurrente, webhooks con firma verificada (incluido el topic `payment`), reconciliador en segundo plano para las notificaciones que se pierden, cancelar / pausar / reanudar, historial de pagos con el motivo real de cada rechazo y auditoría de eventos
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
