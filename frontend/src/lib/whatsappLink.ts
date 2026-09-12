/**
 * Intenta abrir la app de WhatsApp (pantalla principal, no un chat puntual) desde
 * Chrome/Android vía un `intent://` — el esquema estándar que Chrome traduce a un
 * Android Intent explícito. Fuera de Chrome/Android (desktop, Safari, Firefox) el
 * navegador simplemente no reconoce el esquema y no pasa nada: no hay forma de
 * deep-linkear a la pantalla de "Exportar chat" de una conversación específica.
 */
export function openWhatsAppApp() {
  window.location.href = 'intent://send/#Intent;scheme=whatsapp;package=com.whatsapp;end'
}
