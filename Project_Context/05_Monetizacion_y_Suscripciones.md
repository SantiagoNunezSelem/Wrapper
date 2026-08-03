# Monetización y Suscripciones

> **Nota de implementación (2026-08-02).** Este documento es la especificación original. Lo
> que finalmente se implementó difiere en dos puntos, por decisión de producto:
>
> - **Planes:** un único plan **mensual de $7.900 ARS**, en vez de semanal + anual.
> - **Pasarela:** solo **Mercado Pago** (Argentina). Stripe/PayPal quedaron pendientes.
>
> El resto —trial de 1 semana con medio de pago cargado, conversión automática, anti-abuso,
> estados del ciclo de vida y webhooks— se implementó como está descrito acá, con una capa
> extra de anti-abuso (IP y dispositivo, no solo cuenta). Ver el README para la operación.

Este documento detalla el modelo de negocio, el mecanismo de trial, los precios y el ciclo de vida de las suscripciones. Es un desprendimiento de `02_Arquitectura_Tecnica.md` por la complejidad e importancia de acertar en esta lógica (errores acá significan cobrar de más, de menos, o dar acceso PRO gratis indebidamente).

## 1. Modelo de negocio
Suscripción recurrente (no pago único), inspirada en el modelo de "The Cringe" pero corrigiendo su principal punto débil detectado en reseñas: la ausencia de un trial gratuito.

Dos planes:
*   **Semanal**
*   **Anual** (con descuento respecto al equivalente semanal x 52)

## 2. Precios
Los precios deben ser **propios**, no copiar los de The Cringe (que están pensados en USD para mercado global). Deben definirse pensando en el mercado LatAm/Argentina como prioridad, considerando:
*   Precio en pesos argentinos (ARS) para usuarios que pagan vía Mercado Pago.
*   Precio equivalente en USD para usuarios que pagan vía Stripe/PayPal (mercado internacional).
*   El monto final queda a definición de quien implemente el proyecto (o a validar con investigación de mercado adicional), pero debe ser **sensiblemente más accesible** que el benchmark de The Cringe (~USD 9.99/semana, ~USD 30-45/año), ya que el público objetivo inicial es LatAm.
*   Se recomienda dejar el valor numérico exacto en una tabla de configuración/backoffice, no hardcodeado, para poder ajustarlo sin re-deploy.

## 3. Trial gratuito (1 semana)

### 3.1. Regla central
El trial **no es "gratis sin compromiso"**: funciona como una compra con periodo de prueba.
1.  El usuario debe cargar un método de pago válido (tarjeta u otro medio soportado por la pasarela elegida) para poder activar el trial.
2.  Durante los primeros 7 días, el cobro es $0.
3.  Al finalizar el día 7, si el usuario no canceló, se cobra automáticamente el plan que haya elegido (semanal o anual) y la suscripción pasa a estado `activa`, cobrándose luego de forma recurrente según el ciclo del plan.
4.  El usuario puede cancelar en cualquier momento durante el trial sin cargo, y debe conservar acceso PRO hasta el último día del trial ya "pagado" (día 7), pero no se le vuelve a cobrar.

Esto debe implementarse usando las funcionalidades nativas de trial con tarjeta cargada de cada pasarela (Stripe `trial_period_days`, planes de Mercado Pago con período de prueba, PayPal Subscriptions con trial), **no** simulando el trial manualmente sin registrar un método de pago real, ya que eso rompe la conversión automática al finalizar la semana.

### 3.2. Anti-abuso del trial
Reglas para evitar que un mismo usuario reclame el trial múltiples veces:
*   **1 trial por cuenta de Google.** Como el login es obligatorio, se debe registrar a nivel de usuario (`Usuarios`/`Suscripciones`) si esa cuenta ya usó su trial alguna vez (histórico, incluso si canceló y volvió a intentar).
*   Adicionalmente, dado que el trial requiere método de pago cargado, la propia pasarela de pago (Stripe/Mercado Pago/PayPal) ofrece cierta protección adicional contra reintentos con la misma tarjeta, pero **no depender solo de eso**: la validación primaria debe ser a nivel de cuenta de usuario en la base de datos propia.
*   Si un usuario cancela el trial y quiere volver a suscribirse más adelante, debe poder hacerlo, pero **sin volver a recibir el período gratuito** (se le cobra desde el día 1 en el siguiente intento).

### 3.3. Preview de métricas PRO (para usuarios sin trial ni suscripción activa)
Independientemente del trial, las métricas PRO deben mostrarse siempre en el dashboard, pero **bloqueadas/con blur visual**, como forma de generar deseo de compra (upselling pasivo), tal como ya estaba contemplado en el flujo de UI original. El trial es el mecanismo para "probar antes de pagar"; el blur es el mecanismo para "mostrar qué te estás perdiendo".

## 4. Ciclo de vida de la suscripción (estados)
Estados posibles de una `Suscripcion` (ver modelo de datos en `02_Arquitectura_Tecnica.md`):
*   `trial`: método de pago cargado, dentro de los 7 días de prueba, acceso PRO activo, $0 cobrado.
*   `activa`: suscripción pagada y vigente (post-trial o compra directa sin trial si ya usó el trial antes), acceso PRO activo.
*   `pago_fallido`: la pasarela intentó cobrar y falló (tarjeta rechazada, fondos insuficientes, etc.). Se recomienda dar una ventana de gracia corta (ej. 2-3 días) antes de revocar el acceso PRO, para permitir que el usuario actualice su método de pago, y notificarlo (in-app y/o email).
*   `cancelada`: el usuario canceló. Mantiene acceso PRO hasta el final del período ya pagado (o del trial), luego pasa a `vencida`.
*   `inactiva`: sin acceso PRO. El usuario puede volver a suscribirse (sin derecho a nuevo trial si ya lo usó antes).

## 5. Webhooks a implementar por pasarela
Independientemente de la pasarela, el backend debe exponer endpoints de webhook que, como mínimo, manejen estos eventos equivalentes:
*   Suscripción/trial creado.
*   Trial convertido a cobro exitoso (primer pago real).
*   Pago recurrente exitoso (renovaciones siguientes).
*   Pago fallido.
*   Suscripción cancelada por el usuario.
*   Suscripción inactiva/expirada.

Cada webhook debe:
1.  Validar la autenticidad de la notificación (firma/secreto provisto por la pasarela).
2.  Ubicar la `Suscripcion` correspondiente vía `IdSuscripcionExterna`.
3.  Actualizar `Estado` y fechas relevantes.
4.  Registrar el evento (log/auditoría) para poder investigar disputas o reclamos de cobro.

## 6. Resumen de decisiones de negocio (a nivel de checklist)
*   [x] Modelo: suscripción recurrente, no pago único.
*   [x] Planes: semanal y anual.
*   [x] Trial: 1 semana, requiere método de pago, cobro automático al finalizar si no se cancela.
*   [x] Anti-abuso: 1 trial por cuenta de Google (registrado en base de datos propia), sin importar cuántas veces cambie de tarjeta.
*   [x] Precios: propios, más bajos que el benchmark de The Cringe, pensados en ARS/USD para LatAm.
*   [x] Preview de métricas PRO: bloqueado/blur, visible siempre, como gancho de conversión adicional al trial.
