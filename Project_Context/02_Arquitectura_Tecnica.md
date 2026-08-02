# Arquitectura y Stack Tecnológico

## 1. Stack Tecnológico Elegido
*   **Frontend:** React.js (o Next.js para mejor ruteo). Debe soportar i18n (español/inglés) desde el inicio (ej. `next-intl`, `react-i18next`).
*   **Backend:** C# con ASP.NET Core (API RESTful).
*   **Base de Datos:** PostgreSQL o SQL Server (vía Entity Framework Core).
*   **Autenticación:** Google OAuth 2.0.

## 2. Arquitectura de Procesamiento (Híbrida)
Para mantener los costos de infraestructura en $0 en la capa gratuita:
1.  El usuario sube el archivo `.txt` o `.zip` en el navegador.
2.  **React extrae y procesa** el archivo localmente utilizando librerías como `jszip` y algoritmos en Vanilla JS. Los mensajes nunca se envían al servidor.
3.  Una vez calculadas las métricas, React genera un objeto `JSON` ligero con los **resultados**.
4.  Este `JSON` de resultados se envía al backend en ASP.NET Core para ser almacenado en el perfil del usuario autenticado.
5.  Las métricas PRO que requieren APIs externas (ej. análisis de sentimiento) se calculan mediante una llamada puntual del backend a un servicio de IA de bajo costo, enviando únicamente los fragmentos de texto estrictamente necesarios para ese cálculo (no el chat completo), y solo si el usuario tiene una suscripción o trial activo.

## 3. Base de Datos y Usuarios
*   El registro/login es exclusivamente mediante Google.
*   El backend guardará un historial de los análisis realizados por el usuario (solo resultados agregados, nunca mensajes crudos).
*   Modelo relacional básico: `Usuarios` (1) -> (N) `AnalisisGuardados`.
*   La tabla `Usuarios` ya **no debe modelarse con un simple flag booleano `IsPro`**, porque el negocio pasó de pago único a **suscripción recurrente con trial**. En su lugar, necesita reflejar el ciclo de vida de una suscripción. Ver sección 4 y el detalle completo en `05_Monetizacion_y_Suscripciones.md`.

### 3.1. Modelo de datos sugerido (ampliado)
*   `Usuarios`: `Id`, `GoogleId`, `Email`, `Nombre`, `FechaRegistro`, `IdiomaPreferido`.
*   `Suscripciones`: `Id`, `UsuarioId` (FK), `Estado` (`trial`, `activa`, `cancelada`, `inactiva`, `pago_fallido`), `Pasarela` (`mercadopago`, `stripe`, `paypal`), `PlanTipo` (`semanal`, `anual`), `FechaInicioTrial`, `FechaFinTrial`, `FechaInicioSuscripcion`, `FechaProximoCobro`, `FechaCancelacion`, `IdSuscripcionExterna` (id devuelto por la pasarela, necesario para reconciliar webhooks).
*   `AnalisisGuardados`: `Id`, `UsuarioId` (FK), `NombreChat/Alias`, `FechaAnalisis`, `RangoFechasChat`, `JsonResultados`, `MetricasProDesbloqueadas` (booleano, calculado según si al momento de generarse el análisis el usuario tenía suscripción/trial activo).
*   Un usuario tiene "acceso PRO" en un momento dado si tiene una `Suscripcion` con `Estado` en (`trial`, `activa`) y `FechaProximoCobro`/`FechaFinTrial` no vencida. Esto se calcula, no se guarda como un simple booleano estático, ya que puede cambiar automáticamente por webhooks o por vencimiento de fecha.

## 4. Suscripciones y Pasarelas de Pago
El backend en C# debe implementar un patrón Strategy o Factory para manejar múltiples pasarelas de pago **con soporte de suscripciones recurrentes y trial con tarjeta cargada** (no solo cobros únicos):
*   **Mercado Pago (Principal Latam/Argentina):** Integración mediante su SDK de suscripciones (`preapproval`/planes recurrentes), que permite definir un período de prueba (trial) antes del primer cobro.
*   **Stripe:** Procesador principal para pagos internacionales en USD/EUR. Usar Stripe Subscriptions con `trial_period_days` configurado, requiriendo que el usuario cargue un método de pago válido al momento de iniciar el trial (no permitir trial sin tarjeta).
*   **PayPal:** Alternativa de pago internacional, usando PayPal Subscriptions API con período de prueba.

El flujo debe actualizar el `Estado` de la `Suscripcion` (y por lo tanto el acceso PRO del usuario) mediante **webhooks** disparados por las pasarelas ante eventos como: inicio de trial, conversión de trial a cobro, pago exitoso, pago fallido, cancelación, y vencimiento. El detalle completo de este ciclo de vida, las reglas de anti-abuso del trial, y los precios está en `05_Monetizacion_y_Suscripciones.md` — es responsabilidad de la implementación seguir ese documento al pie de la letra, ya que es una pieza crítica y propensa a errores (cobros indebidos, trials infinitos, accesos PRO no revocados a tiempo, etc.).

## 5. Consideraciones de seguridad y confiabilidad
*   Nunca confiar únicamente en el frontend para determinar si un usuario tiene acceso PRO: el backend debe validar el estado de la suscripción en cada request que desbloquee una métrica PRO.
*   Los webhooks de las pasarelas deben validarse (firma/secreto) para evitar que alguien falsifique un evento de "pago exitoso".
*   Debe existir un job/proceso periódico (o validación on-demand) que revise suscripciones vencidas y revoque el acceso PRO automáticamente si el `FechaProximoCobro` pasó sin confirmación de pago.
